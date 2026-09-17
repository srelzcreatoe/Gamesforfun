class_name Interaction
extends Node3D
## Block breaking / placing, item use and melee combos (ARCHITECTURE.md §6, spec §5).
## Owns the crack overlay and the target outline meshes.

const REACH := 4.6
const MIN_BREAK := 0.05
const TIER_SPEED := [1.0, 2.0, 4.0, 6.0, 8.0, 9.0, 12.0]   # hand, wood, stone, iron, diamond, kikono, gete
const COMBO_WINDOW := 0.35
const COMBO_MULT := [1.0, 1.05, 1.35]
const COMBO_STEPS := 3
const EAT_TIME := 1.2

var player: Player = null
var target_block: Vector3i = Vector3i.ZERO
var target_normal: Vector3i = Vector3i.ZERO
var has_target := false
var break_progress := 0.0
var break_total := 0.0
var mining := false

var combo_index := 0
var combo_timer := 0.0
var eat_timer := 0.0
var _place_cd := 0.0
var _outline: MeshInstance3D = null
var _crack: MeshInstance3D = null
var _crack_mats: Array[StandardMaterial3D] = []

func setup(p: Player) -> void:
	player = p

func _ready() -> void:
	_build_outline()
	_build_crack()

func _build_outline() -> void:
	_outline = MeshInstance3D.new()
	_outline.name = "TargetOutline"
	var im := ImmediateMesh.new()
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.vertex_color_use_as_albedo = true
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.albedo_color = Color(0.05, 0.05, 0.05, 0.85)
	mat.no_depth_test = false
	_outline.mesh = im
	_outline.material_override = mat
	_outline.visible = false
	add_child(_outline)
	_rebuild_outline_mesh()

func _rebuild_outline_mesh() -> void:
	var im: ImmediateMesh = _outline.mesh
	var e := 0.004
	var a := Vector3(-e, -e, -e)
	var b := Vector3(1.0 + e, 1.0 + e, 1.0 + e)
	var edges := [
		[Vector3(a.x, a.y, a.z), Vector3(b.x, a.y, a.z)], [Vector3(b.x, a.y, a.z), Vector3(b.x, a.y, b.z)],
		[Vector3(b.x, a.y, b.z), Vector3(a.x, a.y, b.z)], [Vector3(a.x, a.y, b.z), Vector3(a.x, a.y, a.z)],
		[Vector3(a.x, b.y, a.z), Vector3(b.x, b.y, a.z)], [Vector3(b.x, b.y, a.z), Vector3(b.x, b.y, b.z)],
		[Vector3(b.x, b.y, b.z), Vector3(a.x, b.y, b.z)], [Vector3(a.x, b.y, b.z), Vector3(a.x, b.y, a.z)],
		[Vector3(a.x, a.y, a.z), Vector3(a.x, b.y, a.z)], [Vector3(b.x, a.y, a.z), Vector3(b.x, b.y, a.z)],
		[Vector3(b.x, a.y, b.z), Vector3(b.x, b.y, b.z)], [Vector3(a.x, a.y, b.z), Vector3(a.x, b.y, b.z)],
	]
	im.clear_surfaces()
	im.surface_begin(Mesh.PRIMITIVE_LINES)
	var col := Color(0.05, 0.05, 0.05, 0.85)
	if Game != null and bool(Game.settings.get("high_contrast_outline", false)):
		col = Color(1.0, 0.95, 0.2, 0.95)
	for ed in edges:
		im.surface_set_color(col)
		im.surface_add_vertex(ed[0])
		im.surface_set_color(col)
		im.surface_add_vertex(ed[1])
	im.surface_end()

func _build_crack() -> void:
	_crack = MeshInstance3D.new()
	_crack.name = "CrackOverlay"
	var bm := BoxMesh.new()
	bm.size = Vector3(1.008, 1.008, 1.008)
	_crack.mesh = bm
	_crack.position = Vector3(0.5, 0.5, 0.5)
	_crack.visible = false
	for i in 4:
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
		mat.cull_mode = BaseMaterial3D.CULL_BACK
		var tex: Texture2D = Textures.misc("crack_%d" % i) if Textures != null else null
		mat.albedo_texture = tex
		mat.albedo_color = Color(1, 1, 1, 0.85)
		_crack_mats.append(mat)
	add_child(_crack)

# --- helpers used by the HUD ------------------------------------------------

func break_fraction() -> float:
	if break_total <= 0.0:
		return 0.0
	return clampf(break_progress / break_total, 0.0, 1.0)

## Break time in seconds: `max(hardness / tool_speed, 0.05)` (spec §5).
static func break_time(block_def: Dictionary, stack: ItemStack) -> float:
	var hardness := float(block_def.get("hardness", 1.0))
	if hardness < 0.0:
		return -1.0
	return maxf(hardness / tool_speed(block_def, stack), MIN_BREAK)

static func tool_speed(block_def: Dictionary, stack: ItemStack) -> float:
	if stack == null or stack.is_empty():
		return 1.0
	var tool: Dictionary = stack.def().get("tool", {})
	if tool.is_empty():
		return 1.0
	var want := String(block_def.get("tool", "none"))
	if want != "none" and String(tool.get("type", "")) != want:
		return 1.0
	if tool.has("speed"):
		return maxf(1.0, float(tool["speed"]))
	var tier := clampi(int(tool.get("tier", 1)), 0, TIER_SPEED.size() - 1)
	return TIER_SPEED[tier]

static func can_harvest(block_def: Dictionary, stack: ItemStack) -> bool:
	var need := int(block_def.get("min_tier", 0))
	if need <= 0:
		return true
	if stack == null or stack.is_empty():
		return false
	return int(stack.def().get("tool", {}).get("tier", 0)) >= need

# --- per frame -------------------------------------------------------------

func _process(delta: float) -> void:
	if player == null:
		return
	if Game != null and Game.paused_by_ui:
		_stop_mining()
		_outline.visible = false
		_crack.visible = false
		return
	if _place_cd > 0.0:
		_place_cd = maxf(0.0, _place_cd - delta)
	if combo_timer > 0.0:
		combo_timer = maxf(0.0, combo_timer - delta)
		if combo_timer <= 0.0:
			combo_index = 0
	_raycast()
	var inp: PlayerInput = player.input
	var wants_break: bool = inp.break_held or inp.attack
	if wants_break and _is_food_selected() and player.survival != null and player.survival.hunger < PlayerStats.HUNGER_MAX:
		_eat(delta)
		return
	eat_timer = 0.0
	if inp.world_tap or inp.use_pressed:
		_tap()
	if wants_break:
		_mine(delta)
	else:
		_stop_mining()
	_update_visuals()

func _raycast() -> void:
	has_target = false
	var world: Node = player.world
	if world == null or not world.has_method("raycast"):
		return
	var r: Dictionary = world.call("raycast", player.aim_origin(), player.aim_direction(), REACH, true)
	if not bool(r.get("hit", false)):
		return
	has_target = true
	var nb: Vector3i = r.get("block", Vector3i.ZERO)
	if nb != target_block:
		break_progress = 0.0
	target_block = nb
	target_normal = r.get("normal", Vector3i.UP)

func _update_visuals() -> void:
	_outline.visible = has_target and not (Game != null and Game.paused_by_ui)
	if _outline.visible:
		_outline.global_position = Vector3(target_block)
	var f := break_fraction()
	_crack.visible = mining and f > 0.0 and has_target
	if _crack.visible:
		_crack.global_position = Vector3(target_block) + Vector3(0.5, 0.5, 0.5)
		var stage := clampi(int(f * 4.0), 0, 3)
		_crack.material_override = _crack_mats[stage]

func _selected() -> ItemStack:
	return player.selected_stack()

func _is_food_selected() -> bool:
	var st := _selected()
	return not st.is_empty() and st.kind() == "food"

# --- mining ----------------------------------------------------------------

func _mine(delta: float) -> void:
	var world: Node = player.world
	if not has_target or world == null:
		_maybe_melee()
		return
	var id := int(world.call("get_block", target_block.x, target_block.y, target_block.z))
	if id <= 0:
		_stop_mining()
		return
	var def: Dictionary = Registry.block(id)
	var total := break_time(def, _selected())
	if total < 0.0:
		_stop_mining()
		return
	if Game != null and Game.creative:
		total = MIN_BREAK
	break_total = total
	if not mining:
		mining = true
		player.play_anim("base.mining1", 0.1, true)
	break_progress += delta
	if break_progress >= break_total:
		_finish_break(id, def)

func _stop_mining() -> void:
	if mining:
		mining = false
		break_progress = 0.0

func _finish_break(id: int, def: Dictionary) -> void:
	var world: Node = player.world
	break_progress = 0.0
	mining = false
	var pos := target_block
	world.call("set_block", pos.x, pos.y, pos.z, 0, 0, true)
	Audio.play_sfx_at("dig_" + String(def.get("material", "stone")), Vector3(pos) + Vector3(0.5, 0.5, 0.5), linear_to_db(0.7))
	UiUtil.vibrate(12)
	if not can_harvest(def, _selected()):
		return
	for d in def.get("drops", []):
		var item := String(d.get("item", "self"))
		if item == "self":
			item = String(def.get("id", ""))
		var n := int(d.get("count", 1))
		if item == "" or n <= 0:
			continue
		_spawn_drop(item, n, Vector3(pos) + Vector3(0.5, 0.5, 0.5))
	var st := _selected()
	if not st.is_empty() and st.max_durability() > 0:
		st.damage_tool(1)
		player.inventory.notify()

const PICKUP_SCENE := "res://scenes/entities/Pickup.tscn"

func _spawn_drop(item: String, n: int, pos: Vector3) -> void:
	var world: Node = player.world
	if world != null and world.has_method("spawn_entity") and ResourceLoader.exists(PICKUP_SCENE) \
			and Registry != null and Registry.entities.has("item_drop"):
		world.call("spawn_entity", "item_drop", pos, {"item": item, "count": n})
		return
	player.give(item, n)

# --- tap actions -----------------------------------------------------------

func _tap() -> void:
	if _place_cd > 0.0:
		return
	_place_cd = 0.12
	if _melee_or_talk():
		return
	var st := _selected()
	if not st.is_empty() and _use_item(st):
		return
	_place_block()

func _entity_under_aim() -> Node:
	var world: Node = player.world
	if world == null or not world.has_method("get_entities"):
		return null
	var origin := player.aim_origin()
	var dir := player.aim_direction()
	var best: Node = null
	var best_d := REACH
	for e in world.call("get_entities"):
		if e == player or not (e is Node3D):
			continue
		var n3: Node3D = e
		var size: Vector3 = n3.get("aabb_size") if n3.get("aabb_size") != null else Vector3(0.6, 1.8, 0.6)
		var box := AABB(n3.global_position - Vector3(size.x * 0.5, 0.0, size.z * 0.5), size).grow(0.15)
		var hit: Variant = box.intersects_ray(origin, dir)
		if hit == null:
			continue
		var d := (hit as Vector3).distance_to(origin)
		if d < best_d:
			best_d = d
			best = e
	return best

func _melee_or_talk() -> bool:
	var e := _entity_under_aim()
	if e == null:
		return false
	var kind := String(e.get("kind")) if e.get("kind") != null else ""
	if kind == "" and Registry != null:
		kind = String(Registry.entity(String(e.get("entity_type"))).get("kind", ""))
	if kind in ["npc", "master", "trader", "vehicle", "dragon"] and e.has_method("interact"):
		e.call("interact", player)
		return true
	_melee(e)
	return true

func _melee(e: Node) -> void:
	var weapon := _selected()
	var bonus := float(weapon.def().get("weapon", {}).get("damage",
		weapon.def().get("tool", {}).get("damage", 0))) if not weapon.is_empty() else 0.0
	var mult: float = COMBO_MULT[combo_index]
	player.face((e as Node3D).global_position if e is Node3D else player.global_position)
	player.play_action("attack", combo_index)
	combo_index = (combo_index + 1) % COMBO_STEPS
	combo_timer = COMBO_WINDOW
	var power := player.melee_damage + bonus
	var dealt := Damage.deal(e, player, mult, Damage.MELEE, power, player.aim_direction())
	if dealt <= 0.0 and e.has_method("take_damage"):
		e.call("take_damage", power * mult, player, "melee", player.aim_direction() * 3.0 + Vector3.UP * 1.5)
	if not weapon.is_empty() and weapon.max_durability() > 0:
		weapon.damage_tool(1)
		player.inventory.notify()
	Audio.play_sfx("punch")
	UiUtil.vibrate(40)
	if player.camera_rig != null:
		player.camera_rig.shake(0.2, 0.12)

func _maybe_melee() -> void:
	if combo_timer <= 0.0 and player.input.attack_pressed:
		var e := _entity_under_aim()
		if e != null:
			_melee(e)

# --- item use --------------------------------------------------------------

func _use_item(st: ItemStack) -> bool:
	var def := st.def()
	match String(def.get("kind", "")):
		"food":
			return false     # eating is a hold, handled in _eat
		"capsule":
			if String(st.item).contains("house"):
				return _place_capsule_house()
			return false
		"radar":
			_open_radar(def)
			return true
		"dragon_ball":
			return _place_dragon_ball(st)
		"vehicle":
			# SpaceTravel decides: the nimbus mounts, the pod/ship opens the planet map.
			var travel := _quest_node("SpaceTravel")
			if travel != null and travel.has_method("use_vehicle"):
				return bool(travel.call("use_vehicle", st.item))
			if Game != null and Game.ui != null:
				Game.ui.call("open", "space_map", {"vehicle": st.item})
			return true
		"scouter":
			if Game != null and Game.ui != null:
				Game.ui.call("show_hint", "Scouter: nearest power level locked.", 2.0)
			LockOn.toggle(player)
			return true
	return false

func _eat(delta: float) -> void:
	eat_timer += delta
	if eat_timer < EAT_TIME:
		return
	eat_timer = 0.0
	var st := _selected()
	if st.is_empty():
		return
	var food: Dictionary = st.def().get("food", {})
	if player.survival != null:
		player.survival.eat(food)
	player.play_action("eat")
	Audio.play_sfx("eat", linear_to_db(0.8))
	if Game == null or not Game.creative:
		player.inventory.consume_selected(1)

func _quest_node(name: String) -> Node:
	if player != null and player.world != null:
		return player.world.get_node_or_null(name)
	return null

func _open_radar(def: Dictionary) -> void:
	var set_id := String(def.get("radar", {}).get("set", ""))
	var balls := _quest_node("DragonBalls")
	if balls != null and balls.has_method("open_radar"):
		balls.call("open_radar", set_id)
		return
	if balls != null and balls.has_method("radar_readout"):
		if Game != null and Game.ui != null:
			Game.ui.call("show_hint", String(balls.call("radar_readout", player.global_position, set_id)), 4.0)
		return
	if Game != null and Game.ui != null:
		Game.ui.call("show_hint", "Radar: no dragon ball signal here.", 2.5)

func _place_dragon_ball(st: ItemStack) -> bool:
	var balls := _quest_node("DragonBalls")
	if balls != null and balls.has_method("place_ball"):
		balls.call("place_ball", player, st)
		return true
	return false

## `capsule_house`: stamps a small hollow house of blocks in front of the player.
func _place_capsule_house() -> bool:
	var world: Node = player.world
	if world == null or not world.has_method("set_block"):
		return false
	var wall := Registry.block_id("oak_planks")
	if wall < 0:
		wall = Registry.block_id("stone")
	var floor_id := Registry.block_id("stone_bricks")
	if floor_id < 0:
		floor_id = wall
	if wall < 0:
		return false
	var fwd := player.aim_direction()
	fwd.y = 0.0
	if fwd.length() < 0.01:
		fwd = Vector3.FORWARD
	var base := player.global_position + fwd.normalized() * 4.0
	var ox := int(floor(base.x)) - 3
	var oy := int(floor(player.global_position.y))
	var oz := int(floor(base.z)) - 3
	for x in 7:
		for z in 7:
			for y in 5:
				var edge := x == 0 or x == 6 or z == 0 or z == 6
				var id := 0
				if y == 0:
					id = floor_id
				elif y == 4:
					id = wall
				elif edge:
					id = wall
				if y == 1 and x == 3 and z == 0:
					id = 0
				if y == 2 and x == 3 and z == 0:
					id = 0
				if id != 0 or y == 0:
					world.call("set_block", ox + x, oy + y, oz + z, id, 0, true)
	Audio.play_sfx("place_stone", linear_to_db(0.9))
	if Game == null or not Game.creative:
		player.inventory.consume_selected(1)
	if Game != null and Game.ui != null:
		Game.ui.call("toast", "Capsule House", "Deployed.", null)
	return true

# --- placing blocks --------------------------------------------------------

func _place_block() -> bool:
	var world: Node = player.world
	var st := _selected()
	if world == null or st.is_empty() or not has_target:
		return false
	var def := st.def()
	# Minecraft rule: a station/container wins over placing unless the player is sneaking.
	if not player.input.sneak and _open_station():
		return true
	if String(def.get("kind", "")) != "block":
		return false
	var block_name := String(def.get("block", st.item))
	var id := Registry.block_id(block_name)
	if id <= 0:
		return false
	var cell := target_block + target_normal
	var existing := int(world.call("get_block", cell.x, cell.y, cell.z))
	if existing != 0:
		var ed: Dictionary = Registry.block(existing)
		if not bool(ed.get("replaceable", false)):
			return false
	# never intersect an entity AABB
	var box := AABB(Vector3(cell), Vector3.ONE)
	if world.has_method("entities_in_aabb"):
		var arr: Array = world.call("entities_in_aabb", box)
		if arr.size() > 0:
			return false
	if box.intersects(player.aabb()):
		return false
	world.call("set_block", cell.x, cell.y, cell.z, id, 0, true)
	Audio.play_sfx_at("place_" + String(Registry.block(id).get("material", "stone")), Vector3(cell) + Vector3(0.5, 0.5, 0.5), linear_to_db(0.8))
	UiUtil.vibrate(12)
	if Game == null or not Game.creative:
		player.inventory.consume_selected(1)
	return true

func _open_station() -> bool:
	if not has_target or Game == null or Game.ui == null:
		return false
	var world: Node = player.world
	if world == null:
		return false
	var id := int(world.call("get_block", target_block.x, target_block.y, target_block.z))
	if id <= 0:
		return false
	var bid := String(Registry.block(id).get("id", ""))
	match bid:
		"crafting_table":
			Game.ui.call("open", "inventory", {"station": "crafting_table"})
			return true
		"furnace", "lit_furnace", "blast_furnace":
			Game.ui.call("open", "inventory", {"furnace": target_block})
			return true
		"chest", "storage_crate", "barrel":
			Game.ui.call("open", "inventory", {"chest": target_block})
			return true
		"kikono_station":
			Game.ui.call("open", "inventory", {"station": "kikono_station"})
			return true
		"gete_forge":
			Game.ui.call("open", "inventory", {"station": "gete_forge"})
			return true
		"dragon_ball_altar":
			var balls := _quest_node("DragonBalls")
			if balls != null and balls.has_method("altar_interact"):
				return bool(balls.call("altar_interact", player, target_block))
	# Anything else is still an INTERACT objective for the quest engine.
	var qm := _quest_node("QuestManager")
	if qm != null and qm.has_method("notify_interact"):
		qm.call("notify_interact", bid)
	return false
