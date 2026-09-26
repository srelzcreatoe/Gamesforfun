class_name Footsteps
extends RefCounted
## Block material -> step sound with pitch variation (pure static helper, no node).
##
## Two ways to use it:
##   * call `Footsteps.step(world, global_position)` when your own step timer fires
##     (the Player already has one: `Player._footstep()` can be replaced by this call);
##   * keep a `Footsteps.Stepper` and feed it `advance(delta, speed, on_ground, world, pos)`
##     so the distance accumulation, interval and material lookup are handled here.
##
## Every sound used here is a logical name from `data/audio.json` ("step_<material>",
## "land", "splash", "swim"); `Audio` resolves it to a random variant file.

## Materials of docs/DATA_SCHEMA.md §blocks -> relative pitch / loudness of the step.
const MATERIALS: Dictionary = {
	"stone": {"pitch": 0.96, "db": 0.0},
	"earth": {"pitch": 1.0, "db": -0.5},
	"sand": {"pitch": 1.04, "db": -1.5},
	"wood": {"pitch": 0.98, "db": 0.0},
	"plant": {"pitch": 1.08, "db": -3.0},
	"leaves": {"pitch": 1.06, "db": -2.5},
	"glass": {"pitch": 1.05, "db": -1.0},
	"metal": {"pitch": 0.94, "db": 0.5},
	"cloth": {"pitch": 1.02, "db": -3.5},
	"liquid": {"pitch": 1.0, "db": -2.0},
	"snow": {"pitch": 1.1, "db": -2.0},
	"ice": {"pitch": 1.12, "db": -1.0},
	"cloud": {"pitch": 1.14, "db": -4.0},
	"special": {"pitch": 1.0, "db": 0.0},
}

const DEFAULT_MATERIAL := "stone"
## docs/CUBIC_WORLD_UI_SPEC.md: footsteps play at 0.35 linear.
const STEP_VOLUME := 0.35
const PITCH_JITTER := 0.07
## Metres walked between steps (walking / sprinting / crouching).
const STEP_DISTANCE := 1.15
const SPRINT_DISTANCE := 1.45
const CROUCH_DISTANCE := 1.6
## How far below the feet we look for the block we are standing on.
const PROBE_DEPTH: Array[float] = [0.2, 0.6, 1.1]

static var _rng: RandomNumberGenerator = null

static func _rand() -> RandomNumberGenerator:
	if _rng == null:
		_rng = RandomNumberGenerator.new()
		_rng.randomize()
	return _rng

## Logical sound name for a block material (always a name that exists in audio.json).
static func sound_for(material: String) -> String:
	return "step_" + (material if MATERIALS.has(material) else DEFAULT_MATERIAL)

## Material of the block under `pos` ("stone" when the world is unavailable).
static func material_at(world: Node, pos: Vector3) -> String:
	if world == null or not world.has_method("get_block") or Registry == null:
		return DEFAULT_MATERIAL
	var x := int(floor(pos.x))
	var z := int(floor(pos.z))
	# standing in a liquid column counts as a wet step
	var here := int(world.call("get_block", x, int(floor(pos.y)), z))
	if here > 0 and _material_of(here) == "liquid":
		return "liquid"
	for d in PROBE_DEPTH:
		var id := int(world.call("get_block", x, int(floor(pos.y - d)), z))
		if id > 0:
			return _material_of(id)
	return DEFAULT_MATERIAL

static func _material_of(block_id: int) -> String:
	var mat := String(Registry.block(block_id).get("material", DEFAULT_MATERIAL))
	return mat if MATERIALS.has(mat) else DEFAULT_MATERIAL

## Randomised pitch for a material step (0.85 .. 1.25).
static func pitch_for(material: String) -> float:
	var base := float(MATERIALS.get(material, MATERIALS[DEFAULT_MATERIAL])["pitch"])
	return clampf(base + _rand().randf_range(-PITCH_JITTER, PITCH_JITTER), 0.85, 1.25)

static func volume_db_for(material: String, volume_scale := 1.0) -> float:
	var extra := float(MATERIALS.get(material, MATERIALS[DEFAULT_MATERIAL])["db"])
	return linear_to_db(clampf(STEP_VOLUME * volume_scale, 0.001, 1.0)) + extra

## Distance (m) between two steps for the given movement state.
static func step_distance(sprinting := false, crouching := false) -> float:
	if crouching:
		return CROUCH_DISTANCE
	return SPRINT_DISTANCE if sprinting else STEP_DISTANCE

## Play one footstep. `positional` uses the 3D pool (entities); the local player
## should keep the cheap non-positional pool.
static func step(world: Node, pos: Vector3, volume_scale := 1.0, positional := false) -> String:
	var mat := material_at(world, pos)
	play_material(mat, pos, volume_scale, positional)
	return mat

## Play a step for an already known material (skips the block lookup).
static func play_material(material: String, pos: Vector3, volume_scale := 1.0, positional := false) -> void:
	if Audio == null:
		return
	var name := sound_for(material)
	var db := volume_db_for(material, volume_scale)
	var pitch := pitch_for(material)
	if positional:
		Audio.play_sfx_at(name, pos, db, pitch)
	else:
		Audio.play_sfx(name, db, pitch)

## Landing after a fall: "land" plus a material step scaled by the impact speed.
static func land(world: Node, pos: Vector3, fall_speed := 0.0, positional := false) -> void:
	if Audio == null:
		return
	var hard := clampf(absf(fall_speed) / 14.0, 0.0, 1.0)
	var db := linear_to_db(clampf(0.3 + 0.5 * hard, 0.05, 1.0))
	var pitch := clampf(1.1 - 0.25 * hard, 0.8, 1.2)
	if positional:
		Audio.play_sfx_at("land", pos, db, pitch)
	else:
		Audio.play_sfx("land", db, pitch)
	step(world, pos, 0.6 + 0.6 * hard, positional)

## Entering / leaving water.
static func splash(pos: Vector3, strength := 1.0, positional := true) -> void:
	if Audio == null:
		return
	var db := linear_to_db(clampf(0.4 * strength, 0.02, 1.0))
	if positional:
		Audio.play_sfx_at("splash", pos, db, pitch_for("liquid"))
	else:
		Audio.play_sfx("splash", db, pitch_for("liquid"))

## Swim stroke (called on the same cadence as a footstep while swimming).
static func swim(pos: Vector3, positional := false) -> void:
	if Audio == null:
		return
	var db := linear_to_db(0.3)
	if positional:
		Audio.play_sfx_at("swim", pos, db, pitch_for("liquid"))
	else:
		Audio.play_sfx("swim", db, pitch_for("liquid"))

## Distance accumulator: one per actor, keeps the step cadence out of the callers.
class Stepper extends RefCounted:
	var distance := 0.0
	var positional := false
	var volume_scale := 1.0
	var last_material := ""

	## Returns true when a step was played this frame.
	func advance(delta: float, speed: float, on_ground: bool, world: Node, pos: Vector3,
			sprinting := false, crouching := false, swimming := false) -> bool:
		if swimming:
			distance += speed * delta
			if distance >= 1.9:
				distance = 0.0
				Footsteps.swim(pos, positional)
				return true
			return false
		if not on_ground or speed <= 0.3:
			distance = 0.0
			return false
		distance += speed * delta
		if distance < Footsteps.step_distance(sprinting, crouching):
			return false
		distance = 0.0
		last_material = Footsteps.step(world, pos, volume_scale * (0.6 if crouching else 1.0), positional)
		return true

	func reset() -> void:
		distance = 0.0
