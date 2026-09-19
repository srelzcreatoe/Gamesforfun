class_name SpawnPoint
extends RefCounted
## Where the player appears on a planet (docs/briefs/worldgen.md §6).
##
## `find(planet_def, seed)` returns a point on the surface, out of the water, as close to
## (0, 0) as the terrain allows, and clear of the structures that sit near the origin.
## `World` currently spawns from `Game.profile.position` (y < 0 = "use the heightmap"), so this
## is the helper for Game/SpaceTravel when they need a fresh arrival point.

const HEIGHT := WorldConst.HEIGHT
## Rings of candidates scanned outward from the origin.
const MAX_RING := 24
const RING_STEP := 8

static func find(planet_def: Dictionary, seed: int) -> Vector3:
	var kind := String(planet_def.get("generator", "earth"))
	if kind == "space" or kind == "orbit":
		return Vector3(0.5, 72.0, 0.5)
	return find_with(Terrain.make(planet_def, seed), planet_def)

## Same search against an already configured Terrain (the generators call this so they know
## where the player will arrive and can keep that spot clear).
static func find_with(terrain: Terrain, planet_def: Dictionary) -> Vector3:
	var kind := String(planet_def.get("generator", "earth"))
	if kind == "space" or kind == "orbit":
		return Vector3(0.5, 72.0, 0.5)
	var seed := terrain.seed
	if kind == "otherworld" or kind == "time_chamber":
		return Vector3(0.5, float(terrain.plane_y + 1), 8.5)
	var sea := terrain.sea_level
	var best := Vector3(0.5, float(terrain.height_at(0, 0)), 0.5)
	var best_score := -1.0e20
	for ring in MAX_RING:
		var r := ring * RING_STEP
		var samples: int = maxi(1, ring * 6)
		for s in samples:
			var ang := (float(s) / float(samples)) * TAU + Terrain.hash_unit(seed, ring, 3, 9)
			var x := int(round(cos(ang) * float(r)))
			var z := int(round(sin(ang) * float(r)))
			var h := terrain.height_at(x, z)
			if terrain.has_sea and h <= sea + 1:
				continue
			# Prefer flat ground close to the origin.
			var flat := 0
			for d in [Vector2i(3, 0), Vector2i(-3, 0), Vector2i(0, 3), Vector2i(0, -3)]:
				flat += absi(terrain.height_at(x + d.x, z + d.y) - h)
			var score := -float(r) * 0.5 - float(flat) * 2.0
			if score > best_score:
				best_score = score
				best = Vector3(float(x) + 0.5, float(h), float(z) + 0.5)
		if best_score > -60.0 and r >= 16:
			break
	return best
