class_name AmbientLife
extends Node3D
## The ambient-life director: one node under the World that makes the place feel inhabited.
##
## It owns every ambient emitter (mote fields, butterflies, bird flocks, leaf fall, the reactive
## one-shots and the heat shimmer), decides what should exist right now by asking AmbientRules,
## and hands out a single shared quad budget so the whole layer can never cost more than a fixed
## slice of the frame.
##
## Cost model: one `_process` that does nothing but accumulate delta, and one tick every 0.25 s
## that writes a bounded number of MultiMesh instance transforms. Particle nodes are animated by
## the engine and the MultiMesh fields are animated entirely in their shaders, so between ticks
## the ambient layer uses no main-thread time at all.
##
## Public API (AmbientBoot drives these; everything else is internal):
##   bind(world)              attach to a World and start ticking
##   unbind()                 detach, stop everything, release every pooled node
##   set_quad_cap(n)          change the global quad budget (settings/quality)
##   tick()                   run one decision tick immediately (tests, screenshots)
##   stats() -> Dictionary    counts + timings for the --profile line
##   splash/debris/... are reached through Events; no other subsystem has to call into this.

const TICK := 0.25
const SPAWN_MIN := 5.0
const SPAWN_MAX := 24.0
## Fireflies, butterflies and snow sparkle are only readable within a few metres, so they get a
## tighter ring than the pollen/dust haze that fills the middle distance.
const NEAR_MIN := 2.0
const NEAR_MAX := 15.0
const DESPAWN := 40.0
const MOVES_PER_TICK := 14
const CANOPY_SAMPLES := 8
const CANOPY_DEPTH := 5
const CANOPY_RADIUS := 16.0
const FOOTSTEP_STRIDE := 1.8
const PROFILE_PERIOD := 5.0

const MAX_MOTES := 90
const MAX_MOTES_SECONDARY := 40
const MAX_BUTTERFLIES := 14
const MAX_BIRDS := 6
const BLOCK_EVENTS_PER_TICK := 2

var world: Node = null
var budget: AmbientBudget = null

var motes: AmbientMotes = null
var motes_b: AmbientMotes = null
var flyers: AmbientFlyers = null
var flock_near: AmbientFlock = null
var flock_far: AmbientFlock = null
var leaves: AmbientLeaves = null
var reactive: AmbientReactive = null
var shimmer: AmbientShimmer = null

## Context, refreshed every tick (read by the tests and the profile line).
var planet_id := "earth"
var biome_id := ""
var biome_def: Dictionary = {}
var biome_class: int = AmbientRules.Cls.PLAINS
var day_fraction := 0.25
var weather := "clear"
var daylight := 1.0
var wind_dir := Vector2(0.8, 0.6)
var wind_gust := 0.35
var center := Vector3.ZERO

var enabled := true
var force_profile := false

var _rng := RandomNumberGenerator.new()
var _accum := 0.0
var _profile_timer := 0.0
var _tick_usec_sum := 0
var _tick_usec_max := 0
var _ticks := 0
var _frames := 0
var _star_timer := 0.0
var _flash_timer := 0.0
var _foot_dist := 0.0
var _last_foot_pos := Vector3.ZERO
var _foot_valid := false
var _block_events := 0
var _leaf_colors: Array[Color] = []
var _bound := false
var _seeded := false

# --- lifecycle --------------------------------------------------------------------------------

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_PAUSABLE
	_ensure_built()

## Build the emitters and hook up the Events bus. Idempotent, and safe to run before the node
## enters the tree (AmbientBoot binds a world the moment it hears about it, tests do it by hand).
func _ensure_built() -> void:
	if motes != null:
		return
	if name == "":
		name = "AmbientLife"
	if not _seeded:
		_seeded = true
		_rng.randomize()
	if budget == null:
		budget = AmbientBudget.new(_cap_from_settings())
	# Leaf detection and the debris/footstep colours read the flat block tables. World builds
	# them too; the call is idempotent and only pays once per run.
	if not BlockTable.built:
		BlockTable.build()
	_build()
	_connect_events()

func _build() -> void:
	if motes != null:
		return
	var quality := _quality()
	motes = AmbientMotes.new()
	motes.setup(int(MAX_MOTES * quality) if quality < 1.0 else MAX_MOTES, _rng.randi())
	add_child(motes)
	motes_b = AmbientMotes.new()
	motes_b.setup(int(MAX_MOTES_SECONDARY * quality) if quality < 1.0 else MAX_MOTES_SECONDARY, _rng.randi())
	motes_b.name = "AmbientMotesB"
	add_child(motes_b)
	flyers = AmbientFlyers.new()
	flyers.setup(MAX_BUTTERFLIES, _rng.randi())
	add_child(flyers)
	flock_near = AmbientFlock.new()
	flock_near.setup(MAX_BIRDS, _rng.randi())
	flock_near.name = "AmbientFlockNear"
	add_child(flock_near)
	flock_far = AmbientFlock.new()
	flock_far.setup(MAX_BIRDS, _rng.randi())
	flock_far.name = "AmbientFlockFar"
	add_child(flock_far)
	leaves = AmbientLeaves.new()
	leaves.setup()
	add_child(leaves)
	_leaf_colors.resize(AmbientLeaves.MAX_EMITTERS)
	for i in _leaf_colors.size():
		_leaf_colors[i] = Color(0.35, 0.55, 0.2)
	reactive = AmbientReactive.new()
	reactive.setup(budget, _rng.randi())
	add_child(reactive)
	shimmer = AmbientShimmer.new()
	shimmer.setup()
	add_child(shimmer)

func _connect_events() -> void:
	if Events == null:
		return
	if not Events.splash.is_connected(_on_splash):
		Events.splash.connect(_on_splash)
	if not Events.block_changed.is_connected(_on_block_changed):
		Events.block_changed.connect(_on_block_changed)
	if not Events.explosion.is_connected(_on_explosion):
		Events.explosion.connect(_on_explosion)
	if not Events.entity_died.is_connected(_on_entity_died):
		Events.entity_died.connect(_on_entity_died)

func _disconnect_events() -> void:
	if Events == null:
		return
	if Events.splash.is_connected(_on_splash):
		Events.splash.disconnect(_on_splash)
	if Events.block_changed.is_connected(_on_block_changed):
		Events.block_changed.disconnect(_on_block_changed)
	if Events.explosion.is_connected(_on_explosion):
		Events.explosion.disconnect(_on_explosion)
	if Events.entity_died.is_connected(_on_entity_died):
		Events.entity_died.disconnect(_on_entity_died)

func _enter_tree() -> void:
	_connect_events()

## Detached from the world (world unload, planet change): stop listening immediately instead of
## waiting for the deferred free, so a dying ambient layer never answers a live event.
func _exit_tree() -> void:
	_disconnect_events()
	_bound = false

## Attach to a World. Safe to call with null (the node then simply idles).
func bind(w: Node) -> void:
	_ensure_built()
	world = w
	_bound = w != null
	if w != null:
		planet_id = String(w.get("planet_id")) if "planet_id" in w else "earth"
	_reset_fields()
	if _bound:
		tick()

func unbind() -> void:
	world = null
	_bound = false
	_reset_fields()

func _reset_fields() -> void:
	if motes != null:
		motes.invalidate()
		motes.set_active_count(0)
	if motes_b != null:
		motes_b.invalidate()
		motes_b.set_active_count(0)
	if flyers != null:
		flyers.invalidate()
		flyers.set_active_count(0)
	if flock_near != null:
		flock_near.set_active_count(0)
	if flock_far != null:
		flock_far.set_active_count(0)
	if leaves != null:
		leaves.stop_all()
	if reactive != null:
		reactive.stop_all()
	if shimmer != null:
		shimmer.set_strength(0.0)
	if budget != null:
		budget.reset()
	_foot_valid = false
	_star_timer = 0.0
	_flash_timer = 0.0

func set_quad_cap(n: int) -> void:
	if budget != null:
		budget.cap = maxi(16, n)

func _cap_from_settings() -> int:
	var q := _quality()
	return maxi(48, int(round(float(AmbientBudget.DEFAULT_CAP) * q)))

func _quality() -> float:
	if Game == null:
		return 1.0
	return clampf(float(Game.settings.get("particles", 1.0)), 0.25, 1.0)

# --- frame loop -------------------------------------------------------------------------------

func _process(delta: float) -> void:
	_frames += 1
	_accum += delta
	if _accum >= TICK:
		_accum = 0.0
		if enabled and not (Game != null and Game.paused_by_ui):
			tick()
	_profile_timer += delta
	if _profile_timer >= PROFILE_PERIOD:
		_profile_timer = 0.0
		_print_profile()

## One decision tick. Called every 0.25 s, and directly by tests/screenshots.
func tick() -> void:
	var t0 := Time.get_ticks_usec()
	_refresh_context()
	if reactive != null:
		reactive.expire()
	if world == null or not is_instance_valid(world) or not is_inside_tree():
		# No world, or not in the scene yet (menu, loading, teardown): nothing is alive, nothing
		# is charged for, and nothing touches a node whose global transform does not exist.
		_sleep()
	else:
		_update_motes()
		_update_butterflies()
		_update_flocks()
		_update_leaves()
		_update_sky_events()
		_update_footsteps()
		_update_shimmer()
	_block_events = 0
	var dt := Time.get_ticks_usec() - t0
	_tick_usec_sum += dt
	_tick_usec_max = maxi(_tick_usec_max, dt)
	_ticks += 1

## Put every steady field to sleep and hand its budget back (the reactive one-shots keep theirs
## until they expire on their own).
func _sleep() -> void:
	if motes != null:
		motes.set_active_count(0)
	if motes_b != null:
		motes_b.set_active_count(0)
	if flyers != null:
		flyers.set_active_count(0)
	if flock_near != null:
		flock_near.set_active_count(0)
	if flock_far != null:
		flock_far.set_active_count(0)
	if leaves != null:
		leaves.set_active(0)
	if shimmer != null:
		shimmer.set_strength(0.0)
	if budget != null:
		for c in ["motes", "butterflies", "birds", "leaves", "sky"]:
			budget.claim(String(c), 0)

func _refresh_context() -> void:
	center = _focus()
	if world == null or not is_instance_valid(world):
		biome_id = ""
		biome_def = {}
		biome_class = AmbientRules.Cls.PLAINS
		return
	if "planet_id" in world:
		planet_id = String(world.get("planet_id"))
	if "weather" in world:
		weather = String(world.get("weather"))
	if "wind_dir" in world:
		var wd: Variant = world.get("wind_dir")
		if wd is Vector2:
			wind_dir = wd
	if "wind_gust" in world:
		wind_gust = float(world.get("wind_gust"))
	if world.has_method("day_fraction"):
		day_fraction = float(world.call("day_fraction"))
	if world.has_method("daylight"):
		daylight = float(world.call("daylight"))
	var new_biome := biome_id
	if world.has_method("get_biome"):
		new_biome = String(world.call("get_biome", int(floor(center.x)), int(floor(center.z))))
	if new_biome != biome_id or biome_def.is_empty():
		biome_id = new_biome
		biome_def = Registry.biome(biome_id) if Registry != null else {}
		biome_class = AmbientRules.classify(biome_id, biome_def)

func _focus() -> Vector3:
	if Game != null and Game.player != null and is_instance_valid(Game.player) and Game.player is Node3D:
		return (Game.player as Node3D).global_position
	if is_inside_tree():
		var cam := get_viewport().get_camera_3d()
		if cam != null:
			return cam.global_position
	if world != null and is_instance_valid(world) and "view_center" in world:
		var vc: Variant = world.get("view_center")
		if vc is Vector3:
			return vc
	return Vector3.ZERO

# --- mote fields ------------------------------------------------------------------------------

func _update_motes() -> void:
	if motes == null or motes_b == null:
		return
	var firefly_want := AmbientRules.firefly_count(planet_id, biome_class, day_fraction, weather, motes.capacity)
	var kind_b := AmbientRules.mote_kind(planet_id, biome_class, day_fraction, weather)
	var want_b := AmbientRules.mote_count(kind_b, day_fraction, weather, motes_b.capacity)
	var granted := budget.claim("motes", firefly_want + want_b)
	var a := mini(firefly_want, granted)
	var b := mini(want_b, granted - a)

	if a > 0 and motes.kind != AmbientRules.MOTE_FIREFLY:
		var c := AmbientRules.firefly_color(planet_id)
		# size, glow, wander, radius, rise, blink, fade_end
		motes.configure(AmbientRules.MOTE_FIREFLY, c, AmbientAssets.soft_dot(),
			0.24, 2.8, 0.35, 1.6, 0.0, 2.2, 30.0)
		motes.invalidate()
	if b > 0 and motes_b.kind != kind_b:
		_configure_mote_field(motes_b, kind_b)
		motes_b.invalidate()

	motes.set_active_count(a)
	motes_b.set_active_count(b)
	motes.set_master_alpha(clampf(AmbientRules.night_amount(day_fraction) * 1.4, 0.0, 1.0))
	motes_b.set_master_alpha(1.0)
	var moves := MOVES_PER_TICK
	moves -= _rehome(motes, a, moves, _mote_height_range(AmbientRules.MOTE_FIREFLY),
		_mote_ring(AmbientRules.MOTE_FIREFLY))
	if moves > 0 and b > 0:
		_rehome(motes_b, b, moves, _mote_height_range(kind_b), _mote_ring(kind_b))

func _configure_mote_field(field: AmbientMotes, kind: String) -> void:
	var c := AmbientRules.mote_color(kind)
	var dot := AmbientAssets.soft_dot()
	# configure(kind, colour, sprite, size, glow, wander, radius, rise, blink, fade_end)
	match kind:
		AmbientRules.MOTE_POLLEN:
			field.configure(kind, c, dot, 0.11, 1.7, 0.35, 1.5, 0.045, 0.0, 24.0)
		AmbientRules.MOTE_DUST:
			field.configure(kind, c, dot, 0.09, 1.2, 0.5, 2.2, 0.03, 0.0, 26.0)
		AmbientRules.MOTE_SNOW:
			# Snow does not drift, it twinkles: no rise, a fast sparkle blink.
			field.configure(kind, c, dot, 0.055, 3.0, 0.25, 0.5, 0.0, 9.0, 18.0)
		AmbientRules.MOTE_EMBER:
			field.configure(kind, c, dot, 0.11, 2.4, 0.45, 2.4, 0.07, 0.9, 28.0)
		AmbientRules.MOTE_SPIRIT:
			field.configure(kind, c, dot, 0.12, 1.8, 0.3, 2.0, 0.035, 1.1, 30.0)
		_:
			field.configure(kind, c, dot, 0.08, 1.5, 0.35, 1.5, 0.04, 0.0, 24.0)

## Horizontal spawn ring (min, max) for a kind of speck.
func _mote_ring(kind: String) -> Vector2:
	match kind:
		AmbientRules.MOTE_FIREFLY, AmbientRules.MOTE_SNOW: return Vector2(NEAR_MIN, NEAR_MAX)
		AmbientRules.MOTE_SPIRIT: return Vector2(NEAR_MIN, SPAWN_MAX * 0.8)
		_: return Vector2(SPAWN_MIN, SPAWN_MAX)

func _mote_height_range(kind: String) -> Vector2:
	match kind:
		AmbientRules.MOTE_FIREFLY: return Vector2(0.35, 2.6)
		AmbientRules.MOTE_SNOW: return Vector2(0.06, 0.55)
		AmbientRules.MOTE_EMBER: return Vector2(0.4, 5.0)
		AmbientRules.MOTE_SPIRIT: return Vector2(0.6, 4.5)
		AmbientRules.MOTE_DUST: return Vector2(0.3, 3.2)
		_: return Vector2(0.7, 4.0)

## Re-home every speck that is out of range, up to `budget_moves` of them. Returns moves used.
func _rehome(field: AmbientMotes, count: int, budget_moves: int, height: Vector2, ring: Vector2) -> int:
	var used := 0
	for i in count:
		if used >= budget_moves:
			break
		var h := field.home_of(i)
		if h.y > -9000.0 and Vector2(h.x - center.x, h.z - center.z).length() <= DESPAWN:
			continue
		var spot := _ground_spot(ring.x, ring.y, height.x, height.y, false)
		if spot.y < -9000.0:
			break
		field.place(i, spot)
		used += 1
	return used

# --- butterflies ------------------------------------------------------------------------------

func _update_butterflies() -> void:
	if flyers == null:
		return
	var want := AmbientRules.butterfly_count(planet_id, biome_class, day_fraction, weather,
		AmbientRules.has_flowers(biome_def), flyers.capacity)
	var granted := budget.claim("butterflies", want * 2) / 2
	flyers.set_active_count(granted)
	if granted <= 0:
		return
	flyers.set_light(Color(1, 1, 1).lerp(Color(0.45, 0.5, 0.65), 1.0 - clampf(daylight, 0.0, 1.0)))
	flyers.set_master_alpha(clampf(AmbientRules.day_amount(day_fraction) * 1.5, 0.0, 1.0))
	var moves := 6
	for i in granted:
		if moves <= 0:
			break
		var h := flyers.home_of(i)
		if h.y > -9000.0 and Vector2(h.x - center.x, h.z - center.z).length() <= DESPAWN:
			continue
		var spot := _ground_spot(NEAR_MIN + 0.5, NEAR_MAX, 0.7, 1.9, true)
		if spot.y < -9000.0:
			break
		flyers.place(i, spot, _rng.randf_range(0.9, 2.2))
		moves -= 1

# --- bird flocks ------------------------------------------------------------------------------

func _update_flocks() -> void:
	if flock_near == null or flock_far == null:
		return
	var near_want := AmbientRules.bird_flock_size(planet_id, biome_class, day_fraction, weather)
	near_want = mini(near_want, flock_near.capacity)
	var far_want := 0
	if AmbientRules.distant_flock_visible(planet_id, biome_class, day_fraction, weather):
		far_want = mini(4, flock_far.capacity)
	var granted := budget.claim("birds", near_want + far_want)
	var n := mini(near_want, granted)
	var f := mini(far_want, granted - n)
	if n > 0 and flock_near.active_count() == 0:
		flock_near.configure(AmbientAssets.tex(AmbientAssets.BIRD_TEXTURES[0]),
			Color(1, 1, 1, 0.95), 1.0, 4.5, 260.0, 54.0)
		flock_near.reseed(center, 34.0, 40.0)
	if f > 0 and flock_far.active_count() == 0:
		flock_far.configure(AmbientAssets.tex(AmbientAssets.BIRD_TEXTURES[1]),
			Color(0.16, 0.14, 0.18, 0.9), 1.7, 3.2, 520.0, 96.0)
		flock_far.reseed(center, 78.0, 140.0)
	flock_near.set_active_count(n)
	flock_far.set_active_count(f)
	flock_near.set_master_alpha(clampf(0.25 + daylight, 0.0, 1.0))
	flock_far.set_master_alpha(clampf(AmbientRules.twilight_amount(day_fraction) * 1.6, 0.0, 1.0))
	# A flock whose path the player has walked away from is sent past them again.
	if n > 0 and flock_near.distance_to(center) > 150.0:
		flock_near.reseed(center, 34.0, 40.0)
	if f > 0 and flock_far.distance_to(center) > 420.0:
		flock_far.reseed(center, 78.0, 140.0)

# --- leaf fall --------------------------------------------------------------------------------

func _update_leaves() -> void:
	if leaves == null:
		return
	var rate := AmbientRules.leaf_rate(biome_class, weather, wind_gust)
	var want := 0
	if rate > 0.0:
		want = clampi(int(ceil(rate / 1.2)), 1, AmbientLeaves.MAX_EMITTERS)
	var granted := budget.claim("leaves", want * AmbientLeaves.PER_EMITTER) / AmbientLeaves.PER_EMITTER
	leaves.set_active(granted)
	if granted <= 0:
		return
	var per := rate / float(granted)
	for i in granted:
		var a := leaves.anchor_of(i)
		if a.y > -9000.0 and Vector2(a.x - center.x, a.z - center.z).length() <= DESPAWN:
			# Still in range: refresh the wind so a gust shows up immediately.
			leaves.park(i, a, _leaf_colors[i], per, wind_dir, wind_gust)
			continue
		var found := _find_canopy()
		if found.y < -9000.0:
			break
		var lid := int(found.w)
		_leaf_colors[i] = AmbientAssets.leaf_color(lid, biome_def)
		leaves.park(i, Vector3(found.x, found.y, found.z), _leaf_colors[i], per, wind_dir, wind_gust)

## Look for a leaf block overhead near the player. Returns (x, y, z, block_id), y < -9000 = none.
func _find_canopy() -> Vector4:
	if world == null or not is_instance_valid(world) or not world.has_method("get_height"):
		return Vector4(0, -9999, 0, 0)
	for _s in CANOPY_SAMPLES:
		var a := _rng.randf() * TAU
		# Canopies close to the player read best (a leaf 24 m away is one pixel), so the
		# search starts right overhead instead of at the mote spawn ring.
		var r := _rng.randf_range(1.5, CANOPY_RADIUS)
		var bx := int(floor(center.x + cos(a) * r))
		var bz := int(floor(center.z + sin(a) * r))
		var top := int(world.call("get_height", bx, bz))
		if top <= 1:
			continue
		for d in CANOPY_DEPTH:
			var by := top - 1 - d
			if by < 1:
				break
			var id := int(world.call("get_block", bx, by, bz))
			if _is_leaf(id):
				return Vector4(float(bx) + 0.5, float(by) - 0.4, float(bz) + 0.5, float(id))
	return Vector4(0, -9999, 0, 0)

static func _is_leaf(id: int) -> bool:
	return BlockTable.built and id > 0 and id < BlockTable.sway.size() and BlockTable.sway[id] == 2

# --- night sky --------------------------------------------------------------------------------

func _update_sky_events() -> void:
	if reactive == null:
		return
	var star_every := AmbientRules.shooting_star_interval(planet_id, biome_class, day_fraction, weather)
	if star_every > 0.0:
		_star_timer += TICK
		if _star_timer >= star_every * _rng.randf_range(0.5, 1.5):
			_star_timer = 0.0
			var a := _rng.randf() * TAU
			var from := center + Vector3(cos(a) * 45.0, _rng.randf_range(50.0, 80.0), sin(a) * 45.0)
			var dir := Vector3(cos(a + 2.5), -_rng.randf_range(0.15, 0.45), sin(a + 2.5)).normalized()
			reactive.shooting_star(from, dir)
	else:
		_star_timer = 0.0
	var flash_every := AmbientRules.horizon_flash_interval(planet_id, day_fraction, weather)
	if flash_every > 0.0:
		_flash_timer += TICK
		if _flash_timer >= flash_every * _rng.randf_range(0.6, 1.4):
			_flash_timer = 0.0
			var a := _rng.randf() * TAU
			var pos := center + Vector3(cos(a) * 130.0, _rng.randf_range(14.0, 34.0), sin(a) * 130.0)
			var col := Color(0.6, 0.85, 1.0)
			if AmbientRules.mood(planet_id) == AmbientRules.MOOD_INFERNAL:
				col = Color(1.0, 0.45, 0.15)
			elif weather == "thunder" or weather == "storm" or weather == "thunderstorm":
				col = Color(0.85, 0.92, 1.0)
			reactive.horizon_flash(pos, col)
	else:
		_flash_timer = 0.0

# --- footsteps --------------------------------------------------------------------------------

func _update_footsteps() -> void:
	if reactive == null or Game == null or Game.player == null or not is_instance_valid(Game.player):
		_foot_valid = false
		return
	if not (Game.player is Node3D):
		return
	var p := Game.player as Node3D
	var pos := p.global_position
	if not _foot_valid:
		_last_foot_pos = pos
		_foot_valid = true
		return
	var moved := Vector2(pos.x - _last_foot_pos.x, pos.z - _last_foot_pos.z).length()
	_last_foot_pos = pos
	var grounded := true
	if "on_ground" in p:
		grounded = bool(p.get("on_ground"))
	if "is_flying" in p and bool(p.get("is_flying")):
		grounded = false
	if "in_liquid" in p and bool(p.get("in_liquid")):
		grounded = false
	if not grounded:
		_foot_dist = 0.0
		return
	_foot_dist += moved
	if _foot_dist < FOOTSTEP_STRIDE:
		return
	_foot_dist = 0.0
	if world == null or not is_instance_valid(world) or not world.has_method("get_block"):
		return
	var bx := int(floor(pos.x))
	var by := int(floor(pos.y - 0.2))
	var bz := int(floor(pos.z))
	var id := int(world.call("get_block", bx, by, bz))
	if id <= 0:
		return
	reactive.footstep(pos + Vector3(0, 0.06, 0), AmbientAssets.block_color(id))

# --- heat shimmer -----------------------------------------------------------------------------

func _update_shimmer() -> void:
	if shimmer == null:
		return
	var s := AmbientRules.heat_shimmer(planet_id, biome_class)
	if s > 0.0:
		s *= clampf(0.35 + daylight * 0.85, 0.0, 1.0)
		if AmbientRules.is_wet(weather):
			s *= 0.25
	var mood := AmbientRules.mood(planet_id)
	shimmer.set_haze(Color(1.0, 0.46, 0.2) if mood == AmbientRules.MOOD_INFERNAL else Color(1.0, 0.82, 0.55),
		0.09 if mood == AmbientRules.MOOD_INFERNAL else 0.05)
	shimmer.set_strength(s)

# --- placement --------------------------------------------------------------------------------

## A point on the ground in the spawn ring around the player, `y_min..y_max` above the surface.
## Returns y < -9000 when no loaded, sensible spot was found. `dry` rejects water surfaces.
func _ground_spot(min_r: float, max_r: float, y_min: float, y_max: float, dry: bool) -> Vector3:
	if world == null or not is_instance_valid(world) or not world.has_method("get_height"):
		return Vector3(0, -9999, 0)
	for _s in 4:
		var a := _rng.randf() * TAU
		var r := _rng.randf() * (max_r - min_r) + min_r
		var wx := center.x + cos(a) * r
		var wz := center.z + sin(a) * r
		var bx := int(floor(wx))
		var bz := int(floor(wz))
		var top := int(world.call("get_height", bx, bz))
		if top <= 1:
			continue
		if dry and world.has_method("is_liquid") and bool(world.call("is_liquid", bx, top - 1, bz)):
			continue
		return Vector3(wx, float(top) + _rng.randf_range(y_min, y_max), wz)
	return Vector3(0, -9999, 0)

## The block the focus point is standing on (0 when nothing is loaded there). Used for the
## footstep tint and by the debug demo.
func surface_block_under() -> int:
	if world == null or not is_instance_valid(world) or not world.has_method("get_block"):
		return 0
	return int(world.call("get_block", int(floor(center.x)), int(floor(center.y - 0.2)), int(floor(center.z))))

# --- event handlers (must never assume a world) -----------------------------------------------

func _on_splash(pos: Vector3, strength: float) -> void:
	if reactive == null or not _in_range(pos, 48.0):
		return
	reactive.splash(pos, strength)

func _on_block_changed(pos: Vector3i, old_id: int, new_id: int) -> void:
	if reactive == null or old_id <= 0 or new_id == old_id:
		return
	# An explosion rewrites hundreds of blocks in one frame; two puffs per tick is plenty.
	if _block_events >= BLOCK_EVENTS_PER_TICK:
		return
	var p := Vector3(float(pos.x) + 0.5, float(pos.y) + 0.5, float(pos.z) + 0.5)
	if not _in_range(p, 32.0):
		return
	if BlockTable.built and old_id < BlockTable.liquid.size() and BlockTable.liquid[old_id] == 1:
		return
	_block_events += 1
	reactive.debris(p, AmbientAssets.block_color(old_id), 1.0)

func _on_explosion(center_pos: Vector3, radius: float, _power: float) -> void:
	if reactive == null or not _in_range(center_pos, 64.0):
		return
	reactive.explosion(center_pos, radius)

func _on_entity_died(entity: Node, _killer: Node) -> void:
	if reactive == null or entity == null or not is_instance_valid(entity) or not (entity is Node3D):
		return
	var pos := (entity as Node3D).global_position
	if not _in_range(pos, 48.0):
		return
	var etype := ""
	if "entity_type" in entity:
		etype = String(entity.get("entity_type"))
	var def: Dictionary = Registry.entity(etype) if Registry != null and etype != "" else {}
	var kind := String(def.get("kind", "enemy"))
	var height := 1.8
	var hb: Variant = def.get("hitbox", null)
	if hb is Array and (hb as Array).size() >= 2:
		height = float((hb as Array)[1])
	elif "aabb_size" in entity:
		var sz: Variant = entity.get("aabb_size")
		if sz is Vector3:
			height = (sz as Vector3).y
	if not AmbientRules.is_soul_kind(kind, height):
		return
	var faction := String(entity.get("faction")) if "faction" in entity else String(def.get("faction", "wild"))
	reactive.wisp(pos + Vector3(0, height * 0.5, 0), AmbientRules.soul_color(faction))

func _in_range(pos: Vector3, r: float) -> bool:
	if not _bound:
		return false
	return Vector2(pos.x - center.x, pos.z - center.z).length() <= r

# --- profiling --------------------------------------------------------------------------------

func stats() -> Dictionary:
	return {
		"quads": budget.total() if budget != null else 0,
		"cap": budget.cap if budget != null else 0,
		"motes": motes.active_count() if motes != null else 0,
		"motes_b": motes_b.active_count() if motes_b != null else 0,
		"butterflies": flyers.active_count() if flyers != null else 0,
		"birds": (flock_near.active_count() if flock_near != null else 0) + (flock_far.active_count() if flock_far != null else 0),
		"leaf_emitters": leaves.active if leaves != null else 0,
		"bursts": reactive.live_count() if reactive != null else 0,
		"biome": biome_id,
		"class": biome_class,
		"planet": planet_id,
		"tick_ms_avg": (float(_tick_usec_sum) / maxf(1.0, float(_ticks))) / 1000.0,
		"tick_ms_max": float(_tick_usec_max) / 1000.0,
		"ticks": _ticks,
		"frames": _frames,
	}

## Printed 5 s after the ChunkManager world line so the two can be read together.
func _print_profile() -> void:
	var show := force_profile
	if not show and Game != null:
		show = bool(Game.settings.get("show_fps", false))
	if not show:
		return
	var s := stats()
	# Cost per frame: the tick only runs 4x a second, so amortise it over the frames it covers.
	var per_frame := float(s["tick_ms_avg"]) * float(s["ticks"]) / maxf(1.0, float(s["frames"]))
	Log.i("ambient: %s | %d motes %d dust %d butterflies %d birds %d leaf-emitters %d bursts | tick %.3f ms avg, %.3f ms max -> %.3f ms/frame | %s/%s" % [
		budget.describe() if budget != null else "-",
		s["motes"], s["motes_b"], s["butterflies"], s["birds"], s["leaf_emitters"], s["bursts"],
		s["tick_ms_avg"], s["tick_ms_max"], per_frame, s["planet"], s["biome"]])
	_tick_usec_sum = 0
	_tick_usec_max = 0
	_ticks = 0
	_frames = 0
