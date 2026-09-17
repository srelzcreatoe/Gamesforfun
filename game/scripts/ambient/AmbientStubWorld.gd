class_name AmbientStubWorld
extends Node
## A minimal stand-in for `World` that implements exactly the slice of the §4 World API the
## ambient layer reads. It exists so the ambient system can be unit-tested and previewed without
## generating a voxel world (tests/test_ambient.gd and scenes/ambient/AmbientPreview.tscn).
##
## The ground is a flat plane at `ground_y` made of `surface_block`, optionally with a leaf
## canopy slab at `canopy_y` so the leaf-fall logic has something to hang off.

var planet_id := "earth"
var weather := "clear"
var time_ticks := 6000.0
var wind_dir := Vector2(0.8, 0.6)
var wind_gust := 0.35

var biome_id := "plains"
var ground_y := 64
var canopy_y := -1
var canopy_radius := 3.5
## Where the canopies stand (world xz). Empty + canopy_y > 0 means "leaves everywhere overhead".
var canopy_centers: PackedVector2Array = PackedVector2Array()
var surface_block := 0
var leaf_block := 0
var water := false

func _init() -> void:
	name = "AmbientStubWorld"

func setup(biome: String, planet := "earth", with_canopy := false) -> void:
	biome_id = biome
	planet_id = planet
	if Registry != null:
		surface_block = Registry.block_id("grass_block")
		leaf_block = Registry.block_id("oak_leaves")
	if with_canopy:
		canopy_y = ground_y + 5

func get_height(x: int, z: int) -> int:
	if canopy_y > 0 and _under_canopy(x, z):
		return canopy_y + 2
	return ground_y

func get_biome(_x: int, _z: int) -> String:
	return biome_id

func get_block(x: int, y: int, z: int) -> int:
	if canopy_y > 0 and y >= canopy_y and y <= canopy_y + 1 and _under_canopy(x, z):
		return leaf_block
	if y < ground_y:
		return surface_block
	return 0

func _under_canopy(x: int, z: int) -> bool:
	if canopy_centers.is_empty():
		return true
	for c in canopy_centers:
		if Vector2(float(x) + 0.5 - c.x, float(z) + 0.5 - c.y).length() <= canopy_radius:
			return true
	return false

func get_block_v(p: Vector3i) -> int:
	return get_block(p.x, p.y, p.z)

func is_solid(x: int, y: int, z: int) -> bool:
	return get_block(x, y, z) != 0

func is_liquid(_x: int, _y: int, _z: int) -> bool:
	return water

func get_light(_x: int, _y: int, _z: int) -> int:
	return 15

func day_fraction() -> float:
	return fposmod(time_ticks, 24000.0) / 24000.0

func daylight() -> float:
	return clampf(AmbientRules.day_amount(day_fraction()) * 0.95 + 0.05, 0.0, 1.0)

func is_area_loaded(_pos: Vector3, _radius_blocks: float) -> bool:
	return true

## Put the clock at a named moment so tests and previews read the same.
func set_phase(phase: String) -> void:
	match phase:
		"night": time_ticks = 17000.0
		"midnight": time_ticks = 18000.0
		"dawn": time_ticks = 23200.0
		"dusk": time_ticks = 11900.0
		_: time_ticks = 3000.0
