class_name ChunkManager
extends Node
## Streams chunk columns around `set_view_center`, generates and lights them on
## WorkerThreadPool threads, meshes them there too and uploads at most
## MAX_UPLOADS_PER_FRAME sections per frame (docs/ARCHITECTURE.md §2, §4).
##
## Column life cycle: EMPTY -> (load from disk | generate) -> DECORATED -> LIT (all on a
## worker) -> published on the main thread -> border light merge -> MESHED.
## A column is only meshed once its eight neighbours are LIT, so faces and smooth light at
## chunk borders are correct.

const OPAQUE_SHADER := "res://shaders/chunk_opaque.gdshader"
const CUTOUT_SHADER := "res://shaders/chunk_cutout.gdshader"
const WATER_SHADER := "res://shaders/water.gdshader"
## Phone variants: <= 6 uniforms each, no screen texture, no depth texture (shaders/mobile/).
## GLES3 only guarantees 224 fragment uniform vectors and several mobile GPUs report 256; a
## program that fails to link leaves Godot drawing with an unbound shader, which is the native
## crash we see on real phones. The mobile uniform names are a subset of the desktop ones with
## the same payload, so the push code below and SkyController.apply_to_material feed both.
const OPAQUE_SHADER_MOBILE := "res://shaders/mobile/chunk_opaque_mobile.gdshader"
const CUTOUT_SHADER_MOBILE := "res://shaders/mobile/chunk_cutout_mobile.gdshader"
const WATER_SHADER_MOBILE := "res://shaders/mobile/water_mobile.gdshader"
## Default shallow water tint; mirrors water_params.rgb in shaders/water.gdshader.
const WATER_TINT := Vector3(0.09, 0.28, 0.62)
const MAX_UPLOADS_PER_FRAME := 2
const MAX_PUBLISH_PER_FRAME := 2
const MAX_MERGE_PER_FRAME := 1
## Main-thread budget for one frame of world work (ARCHITECTURE.md §2 asks for <= 4 ms,
## the voxel brief for <= 6 ms). Light merges and new jobs stop once it is used up.
const FRAME_BUDGET_USEC := 3500

var world: Node = null
var chunks_root: Node3D = null
var save: SaveManager = null
var generator: Object = null

var columns: Dictionary = {}                  # Vector2i -> ChunkColumn
var render_distance := 5
var view_center := Vector3.ZERO
var center_chunk := Vector2i(0, 0)
var palette: Dictionary = {}

var mat_opaque: ShaderMaterial = null
var mat_cutout: ShaderMaterial = null
var mat_water: ShaderMaterial = null
var mat_lava: ShaderMaterial = null

## Profiling (one line every 5 s when Game.settings.show_fps).
var stat_gen_ms := 0.0
var stat_gen_count := 0
var stat_mesh_ms := 0.0
var stat_mesh_count := 0
var stat_upload_ms := 0.0
var stat_update_ms := 0.0
var stat_update_max := 0.0
var stat_update_sum := 0.0
var stat_frames := 0
var _stat_timer := 0.0

var _max_gen_tasks := 3
var _max_mesh_tasks := 3
var _gen_ids: Array[int] = []
var _mesh_ids: Array[int] = []
var _mutex := Mutex.new()
var _gen_done: Array = []
var _mesh_done: Array = []
var _pending_gen: Dictionary = {}             # Vector2i -> true while a gen task is queued
var _upload_queue: Array = []
var _publish_queue: Array = []
var _merge_queue: Array[Vector2i] = []
var _nodes: Dictionary = {}                   # Vector2i -> Node3D
var _wanted: Array[Vector2i] = []
var _wanted_center := Vector2i(999999, 999999)
var _wanted_distance := -1
var _shutting_down := false
## `--profile` on the command line prints the world timing line even without show_fps.
var _force_profile := false
var _frame_start := 0

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	# Leave cores for the renderer and the main thread: oversubscribing the CPU makes frames
	# stutter far more than a slightly slower stream does.
	# One generator thread on phones. The Android crash log showed
	# `Array::_ref` failing (a freed container) once three generator threads ran
	# against the shared worldgen caches; a single worker removes worker-to-worker
	# sharing entirely, and the main-thread handoff is mutex'd.
	_max_gen_tasks = 1 if Game.is_mobile() else clampi(OS.get_processor_count() / 2, 1, 3)
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--profile"):
			_force_profile = true
	_max_mesh_tasks = _max_gen_tasks
	_build_materials()

func setup(w: Node, root: Node3D, sm: SaveManager, gen: Object) -> void:
	world = w
	chunks_root = root
	save = sm
	generator = gen
	render_distance = clampi(int(Game.settings.get("render_distance", 5)), 2, 16)
	palette = build_palette()

# --- materials --------------------------------------------------------------

## True when the chunk materials should use the stripped shaders/mobile/ variants: on a phone,
## or with `--force-mobile-shaders` on the command line (which is how the desktop build proves
## the mobile path still compiles).
static func use_mobile_shaders() -> bool:
	for a in OS.get_cmdline_user_args():
		if a == "--force-mobile-shaders":
			return true
	for a in OS.get_cmdline_args():
		if a == "--force-mobile-shaders":
			return true
	return Game != null and Game.is_mobile()

## Desktop path, or its mobile/ variant when this device wants one (and the file is there).
static func shader_for(desktop: String, mobile: String) -> String:
	if use_mobile_shaders() and ResourceLoader.exists(mobile):
		return mobile
	return desktop

func _build_materials() -> void:
	mat_opaque = _make_material(shader_for(OPAQUE_SHADER, OPAQUE_SHADER_MOBILE))
	mat_cutout = _make_material(shader_for(CUTOUT_SHADER, CUTOUT_SHADER_MOBILE))
	var water_path := shader_for(WATER_SHADER, WATER_SHADER_MOBILE)
	mat_water = _make_material(water_path)
	if mat_water != null:
		mat_water.render_priority = 1
		mat_water.set_shader_parameter("water_params", Vector4(WATER_TINT.x, WATER_TINT.y, WATER_TINT.z, 0.0))
	# Lava uses the same shader with water_params.w = 1 (no waves, no sky reflection, full opacity).
	mat_lava = _make_material(water_path)
	if mat_lava != null:
		mat_lava.render_priority = 1
		mat_lava.set_shader_parameter("water_params", Vector4(WATER_TINT.x, WATER_TINT.y, WATER_TINT.z, 1.0))

func _make_material(path: String) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	if ResourceLoader.exists(path):
		m.shader = load(path)
	else:
		Log.e("ChunkManager: missing shader " + path)
		return m
	if Textures.block_atlas != null:
		m.set_shader_parameter("tiles", Textures.block_atlas)
	# Packed lighting contract, shared by every world shader (see shaders/chunk_opaque.gdshader):
	#   sun_params xyz sun colour, w daylight          fog_params xyz fog colour, w fog_start
	#   ambient_params xyz ambient, w fog_end          sun_dir_params xyz sun direction, w time
	m.set_shader_parameter("sun_params", Vector4(1.0, 0.96, 0.9, 1.0))
	m.set_shader_parameter("fog_params", Vector4(0.75, 0.84, 0.96, float(render_distance) * 16.0 * 0.55))
	m.set_shader_parameter("ambient_params", Vector4(0.45, 0.52, 0.66, float(render_distance) * 16.0 * 1.05))
	m.set_shader_parameter("sun_dir_params", Vector4(0.0, 1.0, 0.0, 0.0))
	return m

func materials() -> Array[ShaderMaterial]:
	var out: Array[ShaderMaterial] = []
	for m in [mat_opaque, mat_cutout, mat_water, mat_lava]:
		if m != null:
			out.append(m)
	return out

## Per-biome tint palettes (index = Registry.biome_order index) for the mesher.
static func build_palette() -> Dictionary:
	var grass := PackedColorArray()
	var foliage := PackedColorArray()
	var water := PackedColorArray()
	var n := Registry.biome_order.size()
	if n == 0:
		grass.append(ChunkMesher.GRASS_FALLBACK)
		foliage.append(ChunkMesher.FOLIAGE_FALLBACK)
		water.append(ChunkMesher.WATER_COLOR)
	else:
		for i in n:
			var b := Registry.biome_by_index(i)
			grass.append(_hex(b.get("grass_color", ""), ChunkMesher.GRASS_FALLBACK))
			foliage.append(_hex(b.get("foliage_color", ""), ChunkMesher.FOLIAGE_FALLBACK))
			water.append(_hex(b.get("water_color", ""), ChunkMesher.WATER_COLOR))
	return {"grass": grass, "foliage": foliage, "water": water}

static func _hex(v: Variant, fallback: Color) -> Color:
	if v is String and String(v).begins_with("#") and String(v).length() >= 7:
		return Color.html(String(v))
	return fallback

# --- streaming --------------------------------------------------------------

func set_view_center(pos: Vector3) -> void:
	view_center = pos
	center_chunk = Vector2i(int(floor(pos.x / 16.0)), int(floor(pos.z / 16.0)))

func get_column(cx: int, cz: int) -> ChunkColumn:
	return columns.get(Vector2i(cx, cz), null)

func column_count() -> int:
	return columns.size()

func wanted_columns() -> Array[Vector2i]:
	if center_chunk == _wanted_center and render_distance == _wanted_distance:
		return _wanted
	_wanted_center = center_chunk
	_wanted_distance = render_distance
	var list: Array[Vector2i] = []
	for dz in range(-render_distance, render_distance + 1):
		for dx in range(-render_distance, render_distance + 1):
			if dx * dx + dz * dz > (render_distance + 0.5) * (render_distance + 0.5):
				continue
			list.append(Vector2i(center_chunk.x + dx, center_chunk.y + dz))
	list.sort_custom(func(a: Vector2i, b: Vector2i) -> bool:
		var da := (a - center_chunk)
		var db := (b - center_chunk)
		return da.x * da.x + da.y * da.y < db.x * db.x + db.y * db.y)
	_wanted = list
	return _wanted

## Progress towards a *playable* world: the 5x5 ring around the view centre (the rest keeps
## streaming in the background, so the loading screen must not wait for it).
func load_progress() -> float:
	# Phones spawn as soon as the 3x3 ring is meshed (the rest streams in behind the
	# player); desktop waits for the 5x5 ring.
	var r: int = mini(render_distance, 1 if Game.is_mobile() else 2)
	var total := 0
	var ready := 0
	for dz in range(-r, r + 1):
		for dx in range(-r, r + 1):
			total += 1
			var col: ChunkColumn = columns.get(Vector2i(center_chunk.x + dx, center_chunk.y + dz), null)
			if col != null and col.state >= ChunkColumn.MESHED:
				ready += 1
	if total == 0:
		return 1.0
	return float(ready) / float(total)

## Fraction of the full render distance that is meshed (debug / profiling).
func stream_progress() -> float:
	var want := wanted_columns()
	if want.is_empty():
		return 1.0
	var ready := 0
	for k in want:
		var col: ChunkColumn = columns.get(k, null)
		if col != null and col.state >= ChunkColumn.MESHED:
			ready += 1
	return float(ready) / float(want.size())

## Is the 3x3 ring around the view centre meshed (used to time the player spawn)?
func center_ring_ready() -> bool:
	for dz in range(-1, 2):
		for dx in range(-1, 2):
			var col: ChunkColumn = columns.get(Vector2i(center_chunk.x + dx, center_chunk.y + dz), null)
			if col == null or col.state < ChunkColumn.MESHED:
				return false
	return true

func _process(_delta: float) -> void:
	if world == null or _shutting_down:
		return
	var t0 := Time.get_ticks_usec()
	_frame_start = t0
	render_distance = clampi(int(Game.settings.get("render_distance", 5)), 2, 16)
	_collect_finished()
	_drain_merge_queue()
	_request_columns()
	_request_meshes()
	var t1 := Time.get_ticks_usec()
	_upload_meshes()
	stat_upload_ms = float(Time.get_ticks_usec() - t1) / 1000.0
	_unload_far()
	stat_update_ms = float(Time.get_ticks_usec() - t0) / 1000.0
	stat_update_sum += stat_update_ms
	stat_update_max = maxf(stat_update_max, stat_update_ms)
	stat_frames += 1
	_profile(_delta)

func _over_budget() -> bool:
	return Time.get_ticks_usec() - _frame_start > FRAME_BUDGET_USEC

func _profile(delta: float) -> void:
	_stat_timer += delta
	if _stat_timer < 5.0:
		return
	_stat_timer = 0.0
	if not _force_profile and not bool(Game.settings.get("show_fps", false)):
		return
	var gen_avg := stat_gen_ms / maxf(1.0, float(stat_gen_count))
	var mesh_avg := stat_mesh_ms / maxf(1.0, float(stat_mesh_count))
	var upd_avg := stat_update_sum / maxf(1.0, float(stat_frames))
	Log.i("world: %d cols %d%% streamed | worker: gen %.0f ms/col (%d), mesh %.0f ms/section (%d) | main: update %.2f ms avg, %.2f ms max, upload %.2f ms | %d fps" % [
		columns.size(), int(stream_progress() * 100.0), gen_avg, stat_gen_count, mesh_avg, stat_mesh_count,
		upd_avg, stat_update_max, stat_upload_ms, Engine.get_frames_per_second()])
	stat_update_max = 0.0
	stat_update_sum = 0.0
	stat_frames = 0

# --- generation -------------------------------------------------------------

func _request_columns() -> void:
	if _gen_ids.size() >= _max_gen_tasks or _over_budget():
		return
	for k in wanted_columns():
		if columns.has(k) or _pending_gen.has(k):
			continue
		var col := ChunkColumn.new(k.x, k.y)
		_pending_gen[k] = true
		var id := WorkerThreadPool.add_task(_gen_task.bind(col), false, "chunk gen")
		_gen_ids.append(id)
		if _gen_ids.size() >= _max_gen_tasks:
			return

func _gen_task(col: ChunkColumn) -> void:
	var t0 := Time.get_ticks_usec()
	var loaded := false
	if save != null:
		loaded = save.load_column(col)
	if loaded:
		col.state = ChunkColumn.DECORATED
	else:
		if generator != null and generator.has_method("generate_column"):
			generator.call("generate_column", col, world.seed, world.planet_def)
		col.state = ChunkColumn.DECORATED
		col.recompute_heightmap()
	Lighting.compute_column(col)
	col.state = ChunkColumn.LIT
	col.mark_all_dirty()
	var ms := float(Time.get_ticks_usec() - t0) / 1000.0
	_mutex.lock()
	_gen_done.append(col)
	stat_gen_ms += ms
	stat_gen_count += 1
	_mutex.unlock()

func _collect_finished() -> void:
	var still: Array[int] = []
	for id in _gen_ids:
		if WorkerThreadPool.is_task_completed(id):
			WorkerThreadPool.wait_for_task_completion(id)
		else:
			still.append(id)
	_gen_ids = still
	var still_mesh: Array[int] = []
	for id in _mesh_ids:
		if WorkerThreadPool.is_task_completed(id):
			WorkerThreadPool.wait_for_task_completion(id)
		else:
			still_mesh.append(id)
	_mesh_ids = still_mesh
	_mutex.lock()
	var gen: Array = _gen_done.duplicate()
	_gen_done.clear()
	var meshes: Array = _mesh_done.duplicate()
	_mesh_done.clear()
	_mutex.unlock()
	_publish_queue.append_array(gen)
	for m in meshes:
		_upload_queue.append(m)
	var n := 0
	while not _publish_queue.is_empty() and n < MAX_PUBLISH_PER_FRAME:
		_publish(_publish_queue.pop_front())
		n += 1

func _publish(col: ChunkColumn) -> void:
	var k := col.key()
	_pending_gen.erase(k)
	if not _in_range(k, render_distance + 1):
		return                                  # walked away while generating
	columns[k] = col
	if world.has_method("invalidate_column_cache"):
		world.invalidate_column_cache()
	_merge_queue.append(k)
	for e in col.entities_pending:
		if world.has_method("spawn_entity") and e is Dictionary:
			world.spawn_entity(String(e.get("type", "")), e.get("pos", Vector3.ZERO), e.get("data", {}))
	col.entities_pending.clear()
	Events.chunk_ready.emit(k.x, k.y)

func _drain_merge_queue() -> void:
	var n := 0
	while not _merge_queue.is_empty() and n < MAX_MERGE_PER_FRAME and not _over_budget():
		var k: Vector2i = _merge_queue.pop_front()
		var col: ChunkColumn = columns.get(k, null)
		n += 1
		if col == null:
			continue
		Lighting.merge_borders(world, col)

# --- meshing ----------------------------------------------------------------

func _neighbourhood(cx: int, cz: int) -> Array:
	var cols := []
	cols.resize(9)
	for dz in range(-1, 2):
		for dx in range(-1, 2):
			cols[(dz + 1) * 3 + (dx + 1)] = columns.get(Vector2i(cx + dx, cz + dz), null)
	return cols

func _request_meshes() -> void:
	if _mesh_ids.size() >= _max_mesh_tasks or _over_budget():
		return
	for k in wanted_columns():
		var col: ChunkColumn = columns.get(k, null)
		if col == null or col.state < ChunkColumn.LIT:
			continue
		if col.dirty_sections == 0:
			continue
		var cols := _neighbourhood(k.x, k.y)
		var ready := true
		for c in cols:
			if c == null or (c as ChunkColumn).state < ChunkColumn.LIT:
				ready = false
				break
		if not ready:
			continue
		var sections := PackedInt32Array()
		var top: int = mini(WorldConst.SECTIONS - 1, (col.max_height() + 16) >> 4)
		for s in WorldConst.SECTIONS:
			if not col.is_dirty(s):
				continue
			if (col.meshing_sections & (1 << s)) != 0:
				continue
			if s > top and not col.mesh_nodes.has(s):
				col.clear_dirty(s)
				continue
			sections.append(s)
		if sections.is_empty():
			if col.state == ChunkColumn.LIT and col.dirty_sections == 0:
				col.state = ChunkColumn.MESHED
			continue
		for s in sections:
			col.clear_dirty(s)
			col.meshing_sections |= 1 << s
		var job := {
			"key": k, "snap": ChunkMesher.snapshot(cols),
			"sections": sections, "palette": palette,
		}
		var id := WorkerThreadPool.add_task(_mesh_task.bind(job), false, "chunk mesh")
		_mesh_ids.append(id)
		if _mesh_ids.size() >= _max_mesh_tasks or _over_budget():
			return

func _mesh_task(job: Dictionary) -> void:
	var t0 := Time.get_ticks_usec()
	var pad := ChunkMesher.build_pad(job["snap"])
	var out := {}
	var sections: PackedInt32Array = job["sections"]
	for s in sections:
		out[s] = ChunkMesher.build_section(pad, s, job["palette"])
	var ms := float(Time.get_ticks_usec() - t0) / 1000.0
	_mutex.lock()
	_mesh_done.append({"key": job["key"], "sections": out})
	stat_mesh_ms += ms
	stat_mesh_count += sections.size()
	_mutex.unlock()

func _upload_meshes() -> void:
	var uploaded := 0
	while not _upload_queue.is_empty() and uploaded < MAX_UPLOADS_PER_FRAME:
		var res: Dictionary = _upload_queue[0]
		var k: Vector2i = res["key"]
		var col: ChunkColumn = columns.get(k, null)
		var sections: Dictionary = res["sections"]
		if col == null:
			_upload_queue.pop_front()
			continue
		var keys := sections.keys()
		while not keys.is_empty() and uploaded < MAX_UPLOADS_PER_FRAME:
			var s: int = keys[0]
			_apply_section(col, s, sections[s])
			col.meshing_sections &= ~(1 << s)
			sections.erase(s)
			keys.remove_at(0)
			uploaded += 1
		if sections.is_empty():
			_upload_queue.pop_front()
			if col.dirty_sections == 0 and col.meshing_sections == 0:
				col.state = ChunkColumn.MESHED

func _column_node(col: ChunkColumn) -> Node3D:
	var k := col.key()
	var n: Node3D = _nodes.get(k, null)
	if n != null and is_instance_valid(n):
		return n
	n = Node3D.new()
	n.name = "c_%d_%d" % [k.x, k.y]
	n.position = Vector3(k.x * 16, 0, k.y * 16)
	chunks_root.add_child(n)
	_nodes[k] = n
	return n

func _apply_section(col: ChunkColumn, section: int, surfaces: Dictionary) -> void:
	var parent := _column_node(col)
	var mi: MeshInstance3D = col.mesh_nodes.get(section, null)
	if surfaces.is_empty():
		if mi != null and is_instance_valid(mi):
			mi.queue_free()
		col.mesh_nodes.erase(section)
		return
	var mesh := ArrayMesh.new()
	var mats: Array[Material] = []
	if surfaces.has("opaque"):
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, surfaces["opaque"])
		mats.append(mat_opaque)
	if surfaces.has("cutout"):
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, surfaces["cutout"])
		mats.append(mat_cutout)
	if surfaces.has("water"):
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, surfaces["water"])
		mats.append(mat_water)
	if surfaces.has("lava"):
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, surfaces["lava"])
		mats.append(mat_lava)
	if mi == null or not is_instance_valid(mi):
		mi = MeshInstance3D.new()
		mi.name = "s%d" % section
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
		parent.add_child(mi)
		col.mesh_nodes[section] = mi
	mi.mesh = mesh
	for i in mats.size():
		mesh.surface_set_material(i, mats[i])

# --- unloading --------------------------------------------------------------

func _in_range(k: Vector2i, r: int) -> bool:
	var d := k - center_chunk
	return absi(d.x) <= r and absi(d.y) <= r

func _unload_far() -> void:
	if columns.size() <= 8:
		return
	var limit := render_distance + 2
	var drop: Array[Vector2i] = []
	for k in columns.keys():
		if not _in_range(k, limit):
			drop.append(k)
	for k in drop:
		var col: ChunkColumn = columns[k]
		if col.meshing_sections != 0:
			continue                             # wait for the worker to finish
		if col.modified and save != null:
			save.save_column(col)
		var n: Node3D = _nodes.get(k, null)
		if n != null and is_instance_valid(n):
			n.queue_free()
		_nodes.erase(k)
		col.mesh_nodes.clear()
		columns.erase(k)
	if not drop.is_empty() and world.has_method("invalidate_column_cache"):
		world.invalidate_column_cache()

func save_modified() -> int:
	if save == null:
		return 0
	return save.save_all(columns)

func shutdown() -> void:
	_shutting_down = true
	for id in _gen_ids:
		WorkerThreadPool.wait_for_task_completion(id)
	for id in _mesh_ids:
		WorkerThreadPool.wait_for_task_completion(id)
	_gen_ids.clear()
	_mesh_ids.clear()
	_upload_queue.clear()
	_publish_queue.clear()
