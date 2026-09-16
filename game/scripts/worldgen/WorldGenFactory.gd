class_name WorldGenFactory
extends RefCounted
## Picks the generator for a planet (docs/ARCHITECTURE.md §4).
##
## `World._make_generator()` calls `WorldGenFactory.create(planet_def, seed)` and assigns the
## result to `World.generator`; anything with `generate_column(col, seed, planet)` works, and
## every generator here is a `WorldGen` subclass.

## planets.json `generator` -> Terrain mode (used for stand-alone height queries).
const TERRAIN_MODES := {
	"earth": Terrain.MODE_EARTH,
	"namek": Terrain.MODE_NAMEK,
	"sacred": Terrain.MODE_SACRED,
	"vegeta": Terrain.MODE_VEGETA,
	"yardrat": Terrain.MODE_YARDRAT,
	"vampa": Terrain.MODE_VAMPA,
	"cereal": Terrain.MODE_CEREAL,
	"hell": Terrain.MODE_HELL,
	"heaven": Terrain.MODE_HEAVEN,
	"otherworld": Terrain.MODE_FLAT,
	"time_chamber": Terrain.MODE_FLAT,
	"space": Terrain.MODE_FLAT,
	"orbit": Terrain.MODE_FLAT,
}

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

## A Terrain configured like the planet's generator, for height queries without a generator
## (dragon ball placement, spawn point search, tools).
static func make_terrain(planet_def: Dictionary, seed: int) -> Terrain:
	var t := Terrain.new()
	var kind := String(planet_def.get("generator", "earth"))
	t.configure(seed, planet_def, String(TERRAIN_MODES.get(kind, Terrain.MODE_EARTH)))
	if kind == "otherworld" or kind == "time_chamber":
		t.plane_y = 60
	elif kind == "space" or kind == "orbit":
		t.plane_y = 0
	return t
