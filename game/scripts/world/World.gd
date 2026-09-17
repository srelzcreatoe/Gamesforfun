class_name World
extends Node3D
## The voxel world root (scenes/world/World.tscn). Owns the chunk streaming, lighting,
## fluids, time of day, the sky/sun nodes and the entity container.
## Public API: docs/ARCHITECTURE.md §4, with one deviation: the voxel metadata accessors are
## `get_block_meta(x, y, z)` / `set_block_meta(x, y, z, v)`. `get_meta`/`set_meta` from the doc
## collide with `Object.get_meta`/`Object.set_meta`, which GDScript refuses to resolve with
## three arguments (and overriding them would break the engine's own metadata API).

const HEIGHT := WorldConst.HEIGHT
const PLAYER_SCENE := "res://scenes/player/Player.tscn"
const SKY_SCRIPT := "res://scripts/world/SkyController.gd"
const SPAWNER_SCRIPT := "res://scripts/entity/Spawner.gd"
const BGM_DIRECTOR_SCRIPT := "res://scripts/audio/BgmDirector.gd"
const WORLDGEN_FACTORY := "res://scripts/worldgen/WorldGenFactory.gd"
const SPAWN_TIMEOUT := 25.0
## The cutout shader has room for six foliage disturbances; slot 0 is always the player.
const MAX_DISTURBANCES := 6

var planet_id := "earth"
var seed: int = 0
var time_ticks: float = 1000.0
var weather := "clear"
var planet_def: Dictionary = {}
var generator: Object = null

var chunks: Node3D = null
var entities_root: Node3D = null
var sun: DirectionalLight3D = null
var world_env: WorldEnvironment = null
var manager: ChunkManager = null
var fluids: Fluids = null
var save_manager: SaveManager = null
var sky: Node = null
var spawner: Node = null
var view_center := Vector3.ZERO
var spawn_position := Vector3(0.5, 70.0, 0.5)
var debug_camera: Node3D = null

var _started := false
var _spawned := false
var _spawn_wait := 0.0
var _cache_key := Vector2i(0x7fffffff, 0x7fffffff)
var _cache_col: ChunkColumn = null
var _autoplay := false
var _force_debug_camera := false
var _force_flat_gen := false
var _static_camera := false
var _uniform_time := 0.0
var day: int = 0

## --- wind & foliage disturbances (chunk_cutout.gdshader) -------------------
## Direction the wind blows towards in world xz, slowly rotating.
var wind_dir := Vector2(0.8, 0.6).normalized()
## 0..1 gust strength, driven by a slow wave and by the weather.
var wind_gust := 0.35
## Metres a leaf block travels at full gust.
var wind_strength := 0.06
var _wind_angle := 0.6435
var _disturbances: Array[Dictionary] = []
var _disturb_buf := PackedVector4Array()
var _disturb_count := 0

func _ready() -> void:
	chunks = get_node_or_null("Chunks") as Node3D
	if chunks == null:
		chunks = Node3D.new()
		chunks.name = "Chunks"
		add_child(chunks)
	entities_root = get_node_or_null("Entities") as Node3D
	if entities_root == null:
		entities_root = Node3D.new()
		entities_root.name = "Entities"
		add_child(entities_root)
	sun = get_node_or_null("Sun") as DirectionalLight3D
	world_env = get_node_or_null("WorldEnvironment") as WorldEnvironment
	if not BlockTable.built:
		BlockTable.build()
	save_manager = SaveManager.new()
	manager = get_node_or_null("ChunkManager") as ChunkManager
	if manager == null:
		manager = ChunkManager.new()
		manager.name = "ChunkManager"
		add_child(manager)
	fluids = get_node_or_null("Fluids") as Fluids
	if fluids == null:
		fluids = Fluids.new()
		fluids.name = "Fluids"
		add_child(fluids)
	fluids.setup(self)
	_setup_spawner()
	_disturb_buf.resize(MAX_DISTURBANCES)
	if not Events.explosion.is_connected(_on_explosion):
		Events.explosion.connect(_on_explosion)
	if not Events.entity_damaged.is_connected(_on_entity_damaged):
		Events.entity_damaged.connect(_on_entity_damaged)
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--autoplay"):
			_autoplay = true
		elif a.begins_with("--debugcam"):
			_force_debug_camera = true
		elif a.begins_with("--flatgen"):
			_force_flat_gen = true
		elif a.begins_with("--staticcam"):
			_force_debug_camera = true
			_static_camera = true
	_setup_sky()

## The entity engineer's mob spawner lives under the World as "Spawner" (QuestManager looks
## it up by that name). It is optional: the world runs fine without it.
func _setup_spawner() -> void:
	spawner = get_node_or_null("Spawner")
	if spawner == null and ResourceLoader.exists(SPAWNER_SCRIPT):
		var scr: GDScript = load(SPAWNER_SCRIPT)
		if scr != null:
			var n: Variant = scr.new()
			if n is Node:
				spawner = n
				spawner.name = "Spawner"
				add_child(spawner)
	if spawner != null and "world" in spawner:
		spawner.set("world", self)

func _setup_sky() -> void:
	if ResourceLoader.exists(SKY_SCRIPT):
		var scr: GDScript = load(SKY_SCRIPT)
		if scr != null:
			var node: Variant = scr.new()
			if node is Node:
				node.name = "SkyController"
				add_child(node)
				sky = node
				if sky.has_method("bind"):
					sky.call("bind", world_env, sun)

# --- start / shutdown -------------------------------------------------------

func start(info: Dictionary, profile: Dictionary) -> void:
	var pos_info: Dictionary = profile.get("position", {})
	planet_id = String(info.get("planet", pos_info.get("planet", "earth")))
	seed = int(info.get("seed", 0))
	weather = String(info.get("weather", "clear"))
	time_ticks = float(info.get("time_ticks", 1000.0))
	day = int(info.get("day", 0))
	planet_def = Registry.planet(planet_id)
	if planet_def.is_empty():
		planet_def = {"id": planet_id, "sea_level": WorldConst.SEA_LEVEL}
	save_manager.setup(String(info.get("slug", "")), planet_id)
	generator = _make_generator()
	manager.setup(self, chunks, save_manager, generator)
	var sx := float(pos_info.get("x", 0.5))
	var sz := float(pos_info.get("z", 0.5))
	var sy := float(pos_info.get("y", -1.0))
	spawn_position = Vector3(sx, sy, sz)
	set_view_center(Vector3(sx, maxf(sy, float(WorldConst.SEA_LEVEL)), sz))
	_attach_bgm_director()
	_started = true
	Log.i("World.start planet=%s seed=%d spawn=(%.1f, %.1f)" % [planet_id, seed, sx, sz])

## The audio engineer's music director runs under the World when its script exists.
func _attach_bgm_director() -> void:
	if get_node_or_null("BgmDirector") != null:
		return
	if not ResourceLoader.exists(BGM_DIRECTOR_SCRIPT):
		return
	var scr: GDScript = load(BGM_DIRECTOR_SCRIPT)
	if scr == null:
		return
	var n: Variant = scr.new()
	if n is Node:
		n.name = "BgmDirector"
		add_child(n)

func _make_generator() -> Object:
	if ResourceLoader.exists(WORLDGEN_FACTORY) and not _force_flat_gen:
		var scr: GDScript = load(WORLDGEN_FACTORY)
		if scr != null and scr.has_method("create"):
			var g: Variant = scr.call("create", planet_def, seed)
			if g != null and (g as Object).has_method("generate_column"):
				Log.i("World: using WorldGenFactory generator")
				return g
	return FlatTestGen.new(seed)

func shutdown() -> void:
	Events.world_unloading.emit(self)
	if manager != null:
		manager.shutdown()

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE and manager != null:
		manager.shutdown()

# --- blocks -----------------------------------------------------------------

func _col(cx: int, cz: int) -> ChunkColumn:
	var k := Vector2i(cx, cz)
	if k == _cache_key and _cache_col != null:
		return _cache_col
	var c: ChunkColumn = manager.columns.get(k, null) if manager != null else null
	_cache_key = k
	_cache_col = c
	return c

func get_column(cx: int, cz: int) -> ChunkColumn:
	return _col(cx, cz)

## ChunkManager calls this whenever a column is published or unloaded.
func invalidate_column_cache() -> void:
	_cache_key = Vector2i(0x7fffffff, 0x7fffffff)
	_cache_col = null

func get_block(x: int, y: int, z: int) -> int:
	if y < 0 or y >= HEIGHT:
		return 0
	var col := _col(x >> 4, z >> 4)
	if col == null:
		return 0
	return col.blocks[(x & 15) + 16 * ((z & 15) + 16 * y)]

## Like get_block but -1 when the column is not loaded (lighting stops there).
func get_block_raw(x: int, y: int, z: int) -> int:
	if y < 0 or y >= HEIGHT:
		return 0
	var col := _col(x >> 4, z >> 4)
	if col == null:
		return -1
	return col.blocks[(x & 15) + 16 * ((z & 15) + 16 * y)]

func get_block_v(p: Vector3i) -> int:
	return get_block(p.x, p.y, p.z)

func get_block_meta(x: int, y: int, z: int) -> int:
	if y < 0 or y >= HEIGHT:
		return 0
	var col := _col(x >> 4, z >> 4)
	if col == null:
		return 0
	return col.meta[(x & 15) + 16 * ((z & 15) + 16 * y)]

func set_block_meta(x: int, y: int, z: int, v: int) -> void:
	var col := _col(x >> 4, z >> 4)
	if col == null:
		return
	col.meta[(x & 15) + 16 * ((z & 15) + 16 * y)] = v & 255
	col.modified = true
	_mark_dirty(x, y, z)

func set_block(x: int, y: int, z: int, id: int, meta := 0, notify := true) -> void:
	if y < 0 or y >= HEIGHT:
		return
	var col := _col(x >> 4, z >> 4)
	if col == null:
		return
	var i := (x & 15) + 16 * ((z & 15) + 16 * y)
	var old := col.blocks[i]
	var old_meta := col.meta[i]
	if old == id and old_meta == (meta & 255):
		return
	col.blocks[i] = id
	col.meta[i] = meta & 255
	col.modified = true
	col.update_height_at(x & 15, z & 15)
	_mark_dirty(x, y, z)
	Lighting.relight(self, x, y, z, old, id)
	if fluids != null:
		fluids.on_block_changed(Vector3i(x, y, z))
	if notify:
		Events.block_changed.emit(Vector3i(x, y, z), old, id)

func set_block_v(p: Vector3i, id: int, meta := 0, notify := true) -> void:
	set_block(p.x, p.y, p.z, id, meta, notify)

## Mark the section holding (x, y, z) dirty. Sections and columns that merely touch the cell
## are marked too (their meshes sample this cell for face culling and smooth light), but only
## when the cell really sits on a border - this runs for every light write.
func _mark_dirty(x: int, y: int, z: int) -> void:
	var s := y >> 4
	var ly := y & 15
	var lx := x & 15
	var lz := z & 15
	_dirty_column(x >> 4, z >> 4, s, ly)
	if lx == 0:
		_dirty_column((x >> 4) - 1, z >> 4, s, ly)
	elif lx == 15:
		_dirty_column((x >> 4) + 1, z >> 4, s, ly)
	if lz == 0:
		_dirty_column(x >> 4, (z >> 4) - 1, s, ly)
	elif lz == 15:
		_dirty_column(x >> 4, (z >> 4) + 1, s, ly)
	if (lx == 0 or lx == 15) and (lz == 0 or lz == 15):
		_dirty_column((x >> 4) + (-1 if lx == 0 else 1), (z >> 4) + (-1 if lz == 0 else 1), s, ly)

func _dirty_column(cx: int, cz: int, section: int, ly: int) -> void:
	var col: ChunkColumn = manager.columns.get(Vector2i(cx, cz), null) if manager != null else null
	if col == null:
		return
	col.mark_dirty(section)
	if ly == 0:
		col.mark_dirty(section - 1)
	elif ly == 15:
		col.mark_dirty(section + 1)
	if col.state == ChunkColumn.MESHED:
		col.state = ChunkColumn.LIT

func is_solid(x: int, y: int, z: int) -> bool:
	var id := get_block(x, y, z)
	return id != 0 and BlockTable.solid[id] == 1

func is_liquid(x: int, y: int, z: int) -> bool:
	var id := get_block(x, y, z)
	return id != 0 and BlockTable.liquid[id] == 1

func get_height(x: int, z: int) -> int:
	var col := _col(x >> 4, z >> 4)
	if col == null:
		return WorldConst.SEA_LEVEL + 1
	return col.heightmap[(x & 15) + 16 * (z & 15)]

func get_biome(x: int, z: int) -> String:
	var col := _col(x >> 4, z >> 4)
	if col == null:
		return ""
	var idx := col.biomes[(x & 15) + 16 * (z & 15)]
	if idx < Registry.biome_order.size():
		return Registry.biome_order[idx]
	return ""

# --- light ------------------------------------------------------------------

func get_sky_light(x: int, y: int, z: int) -> int:
	if y < 0:
		return 0
	if y >= HEIGHT:
		return 15
	var col := _col(x >> 4, z >> 4)
	if col == null:
		return 0
	return col.light[(x & 15) + 16 * ((z & 15) + 16 * y)] >> 4

func get_block_light(x: int, y: int, z: int) -> int:
	if y < 0 or y >= HEIGHT:
		return 0
	var col := _col(x >> 4, z >> 4)
	if col == null:
		return 0
	return col.light[(x & 15) + 16 * ((z & 15) + 16 * y)] & 15

func set_sky_light(x: int, y: int, z: int, v: int) -> void:
	if y < 0 or y >= HEIGHT:
		return
	var col := _col(x >> 4, z >> 4)
	if col == null:
		return
	var i := (x & 15) + 16 * ((z & 15) + 16 * y)
	col.light[i] = (col.light[i] & 0x0F) | ((v & 15) << 4)
	_mark_dirty(x, y, z)

func set_block_light(x: int, y: int, z: int, v: int) -> void:
	if y < 0 or y >= HEIGHT:
		return
	var col := _col(x >> 4, z >> 4)
	if col == null:
		return
	var i := (x & 15) + 16 * ((z & 15) + 16 * y)
	col.light[i] = (col.light[i] & 0xF0) | (v & 15)
	_mark_dirty(x, y, z)

## Shading value 0..15 used for entities: sky light scaled by daylight, or block light.
func get_light(x: int, y: int, z: int) -> int:
	var s := float(get_sky_light(x, y, z)) * daylight()
	return int(round(maxf(s, float(get_block_light(x, y, z)))))

# --- streaming --------------------------------------------------------------

func set_view_center(pos: Vector3) -> void:
	view_center = pos
	if manager != null:
		manager.set_view_center(pos)

func view_chunk() -> Vector2i:
	return Vector2i(int(floor(view_center.x / 16.0)), int(floor(view_center.z / 16.0)))

func is_area_loaded(pos: Vector3, radius_blocks: float) -> bool:
	var r := int(ceil(radius_blocks / 16.0))
	var cx := int(floor(pos.x / 16.0))
	var cz := int(floor(pos.z / 16.0))
	for dz in range(-r, r + 1):
		for dx in range(-r, r + 1):
			var col := _col(cx + dx, cz + dz)
			if col == null or col.state < ChunkColumn.LIT:
				return false
	return true

func load_progress() -> float:
	return manager.load_progress() if manager != null else 0.0

func save_modified_chunks() -> void:
	if manager == null:
		return
	var n := manager.save_modified()
	if n > 0:
		Log.i("World: saved %d chunk(s)" % n)

func flow_at(x: int, y: int, z: int) -> Vector3:
	return fluids.flow_at(x, y, z) if fluids != null else Vector3.ZERO

func raycast(origin: Vector3, dir: Vector3, max_dist: float, ignore_liquid := true) -> Dictionary:
	return VoxelPhysics.raycast(self, origin, dir, max_dist, ignore_liquid)

# --- time of day ------------------------------------------------------------

func day_fraction() -> float:
	return fposmod(time_ticks, WorldConst.TICKS_PER_DAY) / WorldConst.TICKS_PER_DAY

func sun_direction() -> Vector3:
	if sky != null and sky.has_method("sun_direction"):
		return sky.call("sun_direction")
	var a := day_fraction() * TAU
	return Vector3(cos(a), sin(a), 0.25).normalized()

func daylight() -> float:
	if sky != null and sky.has_method("daylight"):
		return float(sky.call("daylight"))
	var y := sun_direction().y
	return clampf(0.12 + 0.88 * smoothstep(-0.16, 0.22, y), 0.0, 1.0)

func sun_color() -> Color:
	if sky != null and sky.has_method("sun_color"):
		return sky.call("sun_color")
	var y := sun_direction().y
	return Color(1.0, 0.72 + 0.24 * clampf(y, 0.0, 1.0), 0.5 + 0.45 * clampf(y, 0.0, 1.0))

func fog_color() -> Color:
	if sky != null and sky.has_method("fog_color"):
		return sky.call("fog_color")
	var d := daylight()
	return Color(0.16, 0.22, 0.36).lerp(Color(0.75, 0.84, 0.96), d)

func ambient_color() -> Color:
	if sky != null and sky.has_method("ambient_color"):
		return sky.call("ambient_color")
	var d := daylight()
	return Color(0.05, 0.07, 0.12).lerp(Color(0.45, 0.52, 0.66), d)

# --- wind & foliage disturbances --------------------------------------------

## Push the foliage around `pos` for `duration` seconds, fading out. `strength` 0..1 also sets
## the radius (1.6 + strength * 3.0 metres). Six disturbances are live at a time, the player
## always holding the first slot. Called by explosions, hits and anything else that should
## part the grass.
func add_disturbance(pos: Vector3, strength: float, duration := 0.6) -> void:
	if strength <= 0.0:
		return
	_disturbances.append({
		"pos": pos, "strength": clampf(strength, 0.0, 1.0),
		"t": 0.0, "duration": maxf(0.05, duration),
	})
	while _disturbances.size() > MAX_DISTURBANCES - 1:
		_disturbances.pop_front()

func _on_explosion(center: Vector3, radius: float, power: float) -> void:
	add_disturbance(center, clampf(0.45 + power * 0.06, 0.45, 1.0), 0.9)

func _on_entity_damaged(entity: Node, amount: float, _source: Node, _kind: String, _crit: bool) -> void:
	if entity is Node3D and is_instance_valid(entity):
		add_disturbance((entity as Node3D).global_position, clampf(0.35 + amount * 0.01, 0.35, 0.9), 0.5)

func _update_wind(delta: float) -> void:
	_wind_angle += delta * 0.017
	wind_dir = Vector2(cos(_wind_angle), sin(_wind_angle))
	var t := _uniform_time
	var g := 0.34 + 0.26 * sin(t * 0.13) + 0.18 * sin(t * 0.37 + 1.7) + 0.1 * sin(t * 0.91 + 0.4)
	var w := 0.0
	match weather:
		"rain": w = 0.25
		"storm", "thunder", "thunderstorm": w = 0.5
		"snow": w = 0.12
	if sky != null and "weather_node" in sky:
		# Scale with how hard it is actually raining, but a declared storm always blows.
		var wn: Variant = sky.get("weather_node")
		if wn != null and "intensity" in wn:
			w *= clampf(float(wn.get("intensity")), 0.35, 1.0)
	wind_gust = clampf(g + w, 0.0, 1.0)

func _update_disturbances(delta: float) -> void:
	for i in range(_disturbances.size() - 1, -1, -1):
		var d: Dictionary = _disturbances[i]
		d["t"] = float(d["t"]) + delta
		if float(d["t"]) >= float(d["duration"]):
			_disturbances.remove_at(i)
	var n := 0
	# Slot 0: the player's feet. Flying or sprinting parts the foliage much wider.
	if Game.player != null and is_instance_valid(Game.player) and Game.player is Node3D:
		var p := (Game.player as Node3D).global_position
		var strength := 0.6
		if ("is_flying" in Game.player and bool(Game.player.get("is_flying"))) 				or ("is_sprinting" in Game.player and bool(Game.player.get("is_sprinting"))):
			strength = 1.0
		_disturb_buf[0] = Vector4(p.x, p.y, p.z, strength)
		n = 1
	elif debug_camera != null and is_instance_valid(debug_camera):
		var c := debug_camera.global_position
		_disturb_buf[0] = Vector4(c.x, c.y, c.z, 0.6)
		n = 1
	for d in _disturbances:
		if n >= MAX_DISTURBANCES:
			break
		var pos: Vector3 = d["pos"]
		var fade: float = 1.0 - float(d["t"]) / float(d["duration"])
		_disturb_buf[n] = Vector4(pos.x, pos.y, pos.z, float(d["strength"]) * fade)
		n += 1
	for i in range(n, MAX_DISTURBANCES):
		_disturb_buf[i] = Vector4.ZERO
	_disturb_count = n

## Wind uniforms live on the cutout material only (nothing else moves).
func _push_wind_uniforms() -> void:
	if manager == null or manager.mat_cutout == null:
		return
	var m := manager.mat_cutout
	m.set_shader_parameter("wind_dir", wind_dir)
	m.set_shader_parameter("wind_gust", wind_gust)
	m.set_shader_parameter("wind_strength", wind_strength)
	m.set_shader_parameter("disturb", _disturb_buf)
	m.set_shader_parameter("disturb_count", _disturb_count)

## Is the active camera's eye inside a liquid? (the sky/water shaders use it)
func camera_submerged() -> bool:
	var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
	if cam == null:
		return false
	var p := cam.global_position
	return is_liquid(int(floor(p.x)), int(floor(p.y)), int(floor(p.z)))

# --- entities ---------------------------------------------------------------

func spawn_entity(entity_type: String, pos: Vector3, data := {}) -> Node:
	var def := Registry.entity(entity_type)
	var node: Node = null
	var scene_path := String(def.get("scene", ""))
	if scene_path != "" and ResourceLoader.exists(scene_path):
		var packed: PackedScene = load(scene_path)
		if packed != null:
			node = packed.instantiate()
	if node == null:
		node = _placeholder_entity(entity_type)
	node.name = entity_type if entity_type != "" else "entity"
	if node is Node3D:
		(node as Node3D).position = pos
	if "entity_type" in node:
		node.set("entity_type", entity_type)
	if "world" in node:
		node.set("world", self)
	if not data.is_empty() and node.has_method("apply_spawn_data"):
		node.call("apply_spawn_data", data)
	entities_root.add_child(node)
	Events.entity_spawned.emit(node)
	return node

func _placeholder_entity(entity_type: String) -> Node3D:
	var root := Node3D.new()
	var mi := MeshInstance3D.new()
	var box := BoxMesh.new()
	var def := Registry.entity(entity_type)
	var hb: Array = def.get("hitbox", [0.6, 1.8])
	var w := float(hb[0]) if hb.size() > 0 else 0.6
	var h := float(hb[1]) if hb.size() > 1 else 1.8
	box.size = Vector3(w, h, w)
	mi.mesh = box
	mi.position = Vector3(0, h * 0.5, 0)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.9, 0.35, 0.65)
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(mi)
	return root

func get_entities() -> Array[Node]:
	var out: Array[Node] = []
	for c in entities_root.get_children():
		out.append(c)
	return out

func entities_in_aabb(aabb: AABB) -> Array[Node]:
	var out: Array[Node] = []
	for c in entities_root.get_children():
		if not (c is Node3D):
			continue
		var n := c as Node3D
		var size := Vector3(0.6, 1.8, 0.6)
		if "aabb_size" in n:
			size = n.get("aabb_size")
		var box := AABB(n.position - Vector3(size.x * 0.5, 0, size.z * 0.5), size)
		if aabb.intersects(box):
			out.append(c)
	return out

# --- explosions -------------------------------------------------------------

func explode(center: Vector3, radius: float, power: float, source: Node) -> void:
	Events.explosion.emit(center, radius, power)
	var r := int(ceil(radius))
	var cx := int(floor(center.x))
	var cy := int(floor(center.y))
	var cz := int(floor(center.z))
	for dy in range(-r, r + 1):
		for dz in range(-r, r + 1):
			for dx in range(-r, r + 1):
				var d := Vector3(dx, dy, dz).length()
				if d > radius:
					continue
				var x := cx + dx
				var y := cy + dy
				var z := cz + dz
				var id := get_block(x, y, z)
				if id == 0:
					continue
				var hardness: float = BlockTable.hardness[id]
				if hardness < 0.0:
					continue                     # unbreakable
				var strength := power * (1.0 - d / maxf(radius, 0.001))
				if strength > hardness * 0.75:
					set_block(x, y, z, 0, 0, false)
					Events.block_changed.emit(Vector3i(x, y, z), id, 0)
	var box := AABB(center - Vector3.ONE * radius, Vector3.ONE * radius * 2.0)
	for e in entities_in_aabb(box):
		if not e.has_method("take_damage"):
			continue
		var ep: Vector3 = (e as Node3D).position if e is Node3D else center
		var dist: float = ep.distance_to(center)
		var falloff: float = clampf(1.0 - dist / maxf(radius, 0.001), 0.0, 1.0)
		if falloff <= 0.0:
			continue
		var kb: Vector3 = (ep - center).normalized() * power * 0.2 * falloff
		e.call("take_damage", power * falloff, source, "explosion", kb)

# --- per frame --------------------------------------------------------------

func _process(delta: float) -> void:
	if not _started:
		return
	if not Game.paused_by_ui:
		var advanced := time_ticks + delta * (WorldConst.TICKS_PER_DAY / WorldConst.DAY_SECONDS)
		if advanced >= WorldConst.TICKS_PER_DAY:
			# A new day: the moon phase and any "next summon day" logic read this.
			day = day + 1
			if not Game.world_info.is_empty():
				Game.world_info["day"] = day
			if sky != null and "day_index" in sky:
				sky.set("day_index", day)
		time_ticks = fposmod(advanced, WorldConst.TICKS_PER_DAY)
		_uniform_time += delta
		Events.time_changed.emit(time_ticks)
	var focus: Node3D = null
	if Game.player != null and is_instance_valid(Game.player) and Game.player is Node3D:
		focus = Game.player
	elif debug_camera != null and is_instance_valid(debug_camera):
		focus = debug_camera
	if focus != null:
		set_view_center(focus.global_position)
	if sky != null and sky.has_method("apply"):
		if "camera_underwater" in sky:
			sky.set("camera_underwater", camera_submerged())
		sky.call("apply", planet_def, time_ticks, weather, delta)
	elif sun != null:
		_update_fallback_sun()
	_push_uniforms()
	_update_wind(delta)
	_update_disturbances(delta)
	_push_wind_uniforms()
	if not _spawned:
		_spawn_wait += delta
		if manager.center_ring_ready() or _spawn_wait > SPAWN_TIMEOUT:
			_spawn_actor()

func _update_fallback_sun() -> void:
	var dir := sun_direction()
	sun.light_energy = clampf(daylight() * 1.1, 0.05, 1.2)
	sun.light_color = sun_color()
	sun.shadow_enabled = bool(Game.settings.get("shadows", false))
	var up := Vector3.UP if absf(dir.y) < 0.98 else Vector3.FORWARD
	sun.look_at_from_position(dir * 100.0, Vector3.ZERO, up)

func _push_uniforms() -> void:
	if manager == null:
		return
	var d := daylight()
	var sc := sun_color()
	var fc := fog_color()
	var ac := ambient_color()
	var rd := float(manager.render_distance) * 16.0
	var f0 := rd * 0.55
	var f1 := rd * 1.02
	if sky != null and sky.has_method("fog_start"):
		f0 = float(sky.call("fog_start"))
		f1 = float(sky.call("fog_end"))
	if sky != null and sky.has_method("apply_to_material"):
		# The SkyController pushes the shared lighting uniforms (and its own extras) itself.
		for m in manager.materials():
			sky.call("apply_to_material", m)
		return
	for m in manager.materials():
		m.set_shader_parameter("daylight", d)
		m.set_shader_parameter("sun_color", sc)
		m.set_shader_parameter("fog_color", fc)
		m.set_shader_parameter("ambient_color", ac)
		m.set_shader_parameter("fog_start", f0)
		m.set_shader_parameter("fog_end", f1)
		m.set_shader_parameter("time", _uniform_time)

# --- spawning the player / debug camera -------------------------------------

func _spawn_actor() -> void:
	_spawned = true
	var x := spawn_position.x
	var z := spawn_position.z
	var y := spawn_position.y
	if y < 0.0:
		y = float(get_height(int(floor(x)), int(floor(z)))) + 0.1
		if y < 2.0:
			y = float(WorldConst.SEA_LEVEL) + 2.0
	spawn_position = Vector3(x, y, z)
	if ResourceLoader.exists(PLAYER_SCENE) and not _force_debug_camera:
		var packed: PackedScene = load(PLAYER_SCENE)
		if packed != null:
			var p := packed.instantiate()
			if p is Node3D:
				(p as Node3D).position = spawn_position
			if "world" in p:
				p.set("world", self)
			entities_root.add_child(p)
			Game.player = p
			Events.player_spawned.emit(p)
			Log.i("World: player spawned at %s" % str(spawn_position))
			Events.world_loaded.emit(self)
			return
	_spawn_debug_camera()
	Events.world_loaded.emit(self)

func _spawn_debug_camera() -> void:
	var cam := DebugCamera.new()
	cam.name = "DebugCamera"
	cam.world = self
	cam.autoplay = _autoplay
	if _static_camera:
		# --staticcam freezes the orbit so two screenshots can be compared frame to frame.
		cam.orbit_speed = 0.0
	add_child(cam)
	cam.place(spawn_position + Vector3(0, 2.2, 0))
	debug_camera = cam
	Log.i("World: no Player.tscn, using DebugCamera at %s" % str(spawn_position))
