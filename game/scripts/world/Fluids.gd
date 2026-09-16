class_name Fluids
extends Node
## Minecraft-style water/lava simulation (docs/ARCHITECTURE.md §4).
##
## meta layout for liquids: bits 0-3 = level (8 = source, 7..1 = flowing), bit 4 = falling.
## `flow.spread` in blocks.json limits how far a liquid travels from its source (water 7,
## lava 3) and `flow.tick` how many world ticks pass between updates (water 5, lava 30).
##
## Updates are queued per cell, run at 20 world ticks per second, budgeted per tick and
## clipped to `Game.settings.sim_distance` chunks around the view centre.

const HORIZ: Array[Vector3i] = [Vector3i(1, 0, 0), Vector3i(-1, 0, 0), Vector3i(0, 0, 1), Vector3i(0, 0, -1)]
const SOURCE := 8
const BUDGET_PER_TICK := 192

var world: Node = null
## Vector3i -> world tick when the cell should be updated.
var _pending: Dictionary = {}
var _tick: int = 0
var _acc := 0.0
var enabled := true

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_PAUSABLE

func setup(w: Node) -> void:
	world = w

func _process(delta: float) -> void:
	if world == null or not enabled or Game.paused_by_ui:
		return
	_acc += delta * 20.0
	var steps := 0
	while _acc >= 1.0 and steps < 4:
		_acc -= 1.0
		_tick += 1
		steps += 1
		tick()

## One budgeted simulation step. Public so tests can drive it deterministically.
func tick() -> int:
	if world == null or _pending.is_empty():
		return 0
	var ready: Array[Vector3i] = []
	for k in _pending.keys():
		if int(_pending[k]) <= _tick:
			ready.append(k)
			if ready.size() >= BUDGET_PER_TICK:
				break
	var done := 0
	for p in ready:
		_pending.erase(p)
		if _in_sim_range(p):
			_update_cell(p)
			done += 1
	return done

func pending_count() -> int:
	return _pending.size()

## Run until nothing is pending (tests / world load). Bounded by `max_steps`.
func settle(max_steps := 256) -> void:
	var guard := 0
	while not _pending.is_empty() and guard < max_steps:
		_tick += 32
		tick()
		guard += 1

func schedule(p: Vector3i, delay := -1) -> void:
	var id := world.get_block(p.x, p.y, p.z)
	var d := delay
	if d < 0:
		d = int(BlockTable.flow_tick[id]) if (id > 0 and BlockTable.liquid[id] == 1) else 5
		if d <= 0:
			d = 5
	var due := _tick + d
	if _pending.has(p) and int(_pending[p]) <= due:
		return
	_pending[p] = due

## Called by World.set_block: re-evaluate the cell and its six neighbours.
func on_block_changed(p: Vector3i) -> void:
	if world == null:
		return
	schedule(p, 1)
	for f in 6:
		var d: Vector3i = BlockShapes.FACE_DIR[f]
		schedule(Vector3i(p.x + d.x, p.y + d.y, p.z + d.z), 1)

func _in_sim_range(p: Vector3i) -> bool:
	if world == null:
		return false
	var sim: int = int(Game.settings.get("sim_distance", 3))
	var c: Vector2i = world.view_chunk()
	return absi((p.x >> 4) - c.x) <= sim + 1 and absi((p.z >> 4) - c.y) <= sim + 1

# --- simulation -------------------------------------------------------------

func _can_replace(id: int) -> bool:
	return id == 0 or (BlockTable.replaceable[id] == 1 and BlockTable.liquid[id] == 0)

func _level_of(p: Vector3i, id: int) -> int:
	if world.get_block(p.x, p.y, p.z) != id:
		return 0
	var lvl := world.get_meta(p.x, p.y, p.z) & BlockShapes.META_LEVEL
	return SOURCE if lvl == 0 else lvl

func _update_cell(p: Vector3i) -> void:
	var id := world.get_block(p.x, p.y, p.z)
	if id == 0 or BlockTable.liquid[id] == 0:
		return
	var meta := world.get_meta(p.x, p.y, p.z)
	var level: int = meta & BlockShapes.META_LEVEL
	if level == 0:
		level = SOURCE
		world.set_meta(p.x, p.y, p.z, SOURCE)
	var spread: int = maxi(1, int(BlockTable.flow_spread[id]))
	var min_level: int = maxi(1, SOURCE - spread)
	var lava := BlockTable.lava[id] == 1
	# 1. Non-source cells check that they are still fed.
	if level < SOURCE:
		var above_same := world.get_block(p.x, p.y + 1, p.z) == id
		var best := 0
		var sources := 0
		for d in HORIZ:
			var l := _level_of(Vector3i(p.x + d.x, p.y + d.y, p.z + d.z), id)
			if l == SOURCE:
				sources += 1
			best = maxi(best, l)
		if above_same:
			# Falling liquid keeps the maximum level below the source.
			if level != SOURCE - 1 or (meta & BlockShapes.META_FALLING) == 0:
				world.set_block(p.x, p.y, p.z, id, (SOURCE - 1) | BlockShapes.META_FALLING)
				level = SOURCE - 1
		elif not lava and sources >= 2:
			# Infinite water source rule.
			world.set_block(p.x, p.y, p.z, id, SOURCE)
			level = SOURCE
		else:
			var want: int = best - 1
			if want < min_level or best == 0:
				world.set_block(p.x, p.y, p.z, 0, 0)
				for d2 in HORIZ:
					schedule(Vector3i(p.x + d2.x, p.y + d2.y, p.z + d2.z))
				schedule(Vector3i(p.x, p.y + 1, p.z))
				return
			if want != level:
				world.set_block(p.x, p.y, p.z, id, want)
				level = want
	# 2. Flow down.
	var below := Vector3i(p.x, p.y - 1, p.z)
	if _react(p, below, id, lava):
		return
	var bid := world.get_block(below.x, below.y, below.z)
	if _can_replace(bid):
		world.set_block(below.x, below.y, below.z, id, (SOURCE - 1) | BlockShapes.META_FALLING)
		schedule(below)
		return
	if bid == id:
		schedule(below)
		return
	# 3. Flow sideways.
	if level <= min_level:
		return
	var next_level: int = level - 1
	if next_level < min_level:
		return
	for d in HORIZ:
		var n := Vector3i(p.x + d.x, p.y + d.y, p.z + d.z)
		if _react(p, n, id, lava):
			return
		var nid := world.get_block(n.x, n.y, n.z)
		if _can_replace(nid):
			world.set_block(n.x, n.y, n.z, id, next_level)
			schedule(n)
		elif nid == id and _level_of(n, id) < next_level:
			world.set_block(n.x, n.y, n.z, id, next_level)
			schedule(n)

## Lava meeting water (and vice versa) turns into stone. Returns true when `p` was consumed.
func _react(p: Vector3i, n: Vector3i, id: int, lava: bool) -> bool:
	var nid := world.get_block(n.x, n.y, n.z)
	if nid == 0 or BlockTable.liquid[nid] == 0 or nid == id:
		return false
	var other_lava := BlockTable.lava[nid] == 1
	if lava == other_lava:
		return false
	if lava:
		# Our lava touches water: become obsidian (source) or cobblestone (flowing).
		var lvl := world.get_meta(p.x, p.y, p.z) & BlockShapes.META_LEVEL
		var solid_id := BlockTable.id_of("obsidian") if (lvl == 0 or lvl >= SOURCE) else BlockTable.id_of("cobblestone")
		if solid_id <= 0:
			solid_id = BlockTable.id_of("stone")
		world.set_block(p.x, p.y, p.z, solid_id, 0)
		Events.splash.emit(Vector3(p.x + 0.5, p.y + 1.0, p.z + 0.5), 1.0)
		return true
	# Our water touches lava: turn the lava into stone.
	var lvl2 := world.get_meta(n.x, n.y, n.z) & BlockShapes.META_LEVEL
	var made := BlockTable.id_of("obsidian") if (lvl2 == 0 or lvl2 >= SOURCE) else BlockTable.id_of("cobblestone")
	if made <= 0:
		made = BlockTable.id_of("stone")
	world.set_block(n.x, n.y, n.z, made, 0)
	Events.splash.emit(Vector3(n.x + 0.5, n.y + 1.0, n.z + 0.5), 1.0)
	return false

# --- flow vectors -----------------------------------------------------------

## Direction the liquid at (x, y, z) pushes entities, length 0..1 (+ -Y when falling).
func flow_at(x: int, y: int, z: int) -> Vector3:
	if world == null:
		return Vector3.ZERO
	var id := world.get_block(x, y, z)
	if id == 0 or BlockTable.liquid[id] == 0:
		return Vector3.ZERO
	var meta := world.get_meta(x, y, z)
	var level: int = meta & BlockShapes.META_LEVEL
	if level == 0:
		level = SOURCE
	var flow := Vector3.ZERO
	for d in HORIZ:
		var nid := world.get_block(x + d.x, y, z + d.z)
		if nid == id:
			var nl := world.get_meta(x + d.x, y, z + d.z) & BlockShapes.META_LEVEL
			if nl == 0:
				nl = SOURCE
			if nl < level:
				flow += Vector3(d.x, 0, d.z) * float(level - nl)
		elif nid == 0 or BlockTable.solid[nid] == 0:
			var under := world.get_block(x + d.x, y - 1, z + d.z)
			if under == 0 or BlockTable.liquid[under] == 1:
				flow += Vector3(d.x, 0, d.z) * 2.0
			else:
				flow += Vector3(d.x, 0, d.z) * 0.5
	if flow.length_squared() > 0.0:
		flow = flow.normalized()
	if (meta & BlockShapes.META_FALLING) != 0:
		flow.y = -1.0
	return flow
