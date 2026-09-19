class_name WorldGenFactory
extends RefCounted
## Picks the generator for a planet (docs/ARCHITECTURE.md §4).
##
## `World._make_generator()` calls `WorldGenFactory.create(planet_def, seed)` and assigns the
## result to `World.generator`; anything with `generate_column(col, seed, planet)` works, and
## every generator here is a `WorldGen` subclass.

static func create(planet_def: Dictionary, seed: int) -> Object:
	var kind := String(planet_def.get("generator", "earth"))
	match kind:
		"earth": return EarthGen.new(planet_def, seed)
		"namek": return NamekGen.new(planet_def, seed)
		"otherworld": return OtherworldGen.new(planet_def, seed)
		"sacred": return SacredGen.new(planet_def, seed)
		"time_chamber": return TimeChamberGen.new(planet_def, seed)
		"vegeta": return VegetaGen.new(planet_def, seed)
		"yardrat": return YardratGen.new(planet_def, seed)
		"vampa": return VampaGen.new(planet_def, seed)
		"cereal": return CerealGen.new(planet_def, seed)
		"hell": return HellGen.new(planet_def, seed)
		"heaven": return HeavenGen.new(planet_def, seed)
		"space": return SpaceGen.new(planet_def, seed)
		"orbit": return OrbitGen.new(planet_def, seed)
	Log.w("WorldGenFactory: unknown generator '%s', using earth" % kind)
	return EarthGen.new(planet_def, seed)

static func create_for_planet(planet_id: String, seed: int) -> Object:
	var def := Registry.planet(planet_id)
	if def.is_empty():
		def = {"id": planet_id, "generator": "earth", "sea_level": WorldConst.SEA_LEVEL}
	return create(def, seed)

## A Terrain configured like the planet's generator (see Terrain.make).
static func make_terrain(planet_def: Dictionary, seed: int) -> Terrain:
	return Terrain.make(planet_def, seed)

## Where a player should arrive on this planet: on the surface, out of the water, as close to
## (0, 0) as the terrain allows. Call it from Game.create_world() / Game.change_planet() and
## write the result into `profile.position` (x, y, z) instead of the y = -1 "use the
## heightmap" placeholder:
##     var p: Vector3 = WorldGenFactory.spawn_point(Registry.planet(planet_id), seed)
## It only samples the height field (no column generation), so it is cheap and safe to call
## on the main thread.
static func spawn_point(planet_def: Dictionary, seed: int) -> Vector3:
	return SpawnPoint.find(planet_def, seed)
