class_name BiomeMap
extends RefCounted
## Biome selection from data/biomes.json (docs/briefs/worldgen.md §2).
##
## Every biome of the planet is a candidate; land biomes are chosen by climate distance
## (temperature / humidity) with `weight` breaking ties through a medium-scale zone noise,
## while oceans, beaches, rivers and mountains come from the height field. The result is the
## index into `Registry.biome_order`, which is exactly what goes into `ChunkColumn.biomes`.
##
## Read-only after `configure()`, so several worker threads can sample it at once.

const STYLE_EARTH := "earth"
const STYLE_NAMEK := "namek"
const STYLE_SACRED := "sacred"
const STYLE_SINGLE := "single"

var terrain: Terrain = null
var planet_id := "earth"
var style := STYLE_SINGLE
var default_index := 0
## Registry indices for the rule-driven biomes (-1 when the planet has none).
var ocean := -1
var deep_ocean := -1
var frozen_ocean := -1
var beach := -1
var river := -1
var mountains := -1

var _pool_index := PackedInt32Array()
var _pool_temp := PackedFloat32Array()
var _pool_humid := PackedFloat32Array()
var _pool_weight := PackedFloat32Array()
## Earth spawn-zone biomes (kept generous so the Saiyan saga quests always find their biome).
var _spawn_plains := -1
var _spawn_forest := -1
var _spawn_waste := -1
var _spawn_sunflower := -1
## Blocks of the biome defs, indexed like Registry.biome_order.
var _defs: Array = []
## Optional circular override (King Kai's planet, asteroid fields, ...).
var _hot_center := Vector2.ZERO
var _hot_radius := -1.0
var _hot_biome := -1

func configure(p_terrain: Terrain, planet_def: Dictionary, p_style: String) -> void:
	terrain = p_terrain
	planet_id = String(planet_def.get("id", "earth"))
	style = p_style
	_defs = []
	for i in Registry.biome_order.size():
		_defs.append(Registry.biome_by_index(i))
	var ids: Array = planet_def.get("biomes", [])
	default_index = index_of(String(ids[0])) if ids.size() > 0 else 0
	ocean = index_of("ocean")
	deep_ocean = index_of("deep_ocean")
	frozen_ocean = index_of("frozen_ocean")
	beach = index_of("beach")
	river = index_of("river")
	mountains = index_of("mountains")
	_spawn_plains = index_of("plains")
	_spawn_forest = index_of("forest")
	_spawn_waste = index_of("wasteland")
	_spawn_sunflower = index_of("sunflower_plains")
	var rule_driven := ["ocean", "deep_ocean", "frozen_ocean", "beach", "river", "mountains",
		"namekian_rivers", "namek_rocky", "sacredkai_rivers", "sacredkai_hills", "king_kai_planet",
		"asteroid_field"]
	_pool_index = PackedInt32Array()
	_pool_temp = PackedFloat32Array()
	_pool_humid = PackedFloat32Array()
	_pool_weight = PackedFloat32Array()
	for raw in ids:
		var bid := String(raw)
		if bid in rule_driven:
			continue
		var idx := index_of(bid)
		if idx < 0:
			continue
		var def: Dictionary = _defs[idx] if idx < _defs.size() else {}
		_pool_index.append(idx)
		_pool_temp.append(float(def.get("temperature", 0.8)))
		_pool_humid.append(float(def.get("humidity", 0.5)))
		_pool_weight.append(maxf(0.5, float(def.get("weight", 6))))

## Circular biome override, e.g. King Kai's planet inside the Other World.
func set_hotspot(center: Vector2, radius: float, biome_id: String) -> void:
	_hot_center = center
	_hot_radius = radius
	_hot_biome = index_of(biome_id)

## Registry index of a biome id, or -1.
func index_of(id: String) -> int:
	var i := Registry.biome_index(id)
	return i

func def(idx: int) -> Dictionary:
	if idx < 0 or idx >= _defs.size():
		return {}
	return _defs[idx]

func id_of(idx: int) -> String:
	if idx < 0 or idx >= Registry.biome_order.size():
		return ""
	return Registry.biome_order[idx]

## Biome for a column, given the terrain height there.
func at(wx: int, wz: int, h: int) -> int:
	if _hot_radius > 0.0 and _hot_biome >= 0:
		var dx := float(wx) - _hot_center.x
		var dz := float(wz) - _hot_center.y
		if dx * dx + dz * dz <= _hot_radius * _hot_radius:
			return _hot_biome
	match style:
		STYLE_EARTH: return _at_earth(wx, wz, h)
		STYLE_NAMEK: return _at_namek(wx, wz, h)
		STYLE_SACRED: return _at_sacred(wx, wz, h)
		_: return default_index

## Convenience for structure / dragon-ball placement searches.
func at_world(wx: int, wz: int) -> int:
	return at(wx, wz, terrain.height_at(wx, wz))

func id_at_world(wx: int, wz: int) -> String:
	return id_of(at_world(wx, wz))

# --- Earth -----------------------------------------------------------------

func _at_earth(wx: int, wz: int, h: int) -> int:
	var sea := terrain.sea_level
	var temp := terrain.temperature_at(wx, wz)
	if h <= sea:
		if temp < -0.2 and frozen_ocean >= 0:
			return frozen_ocean
		if h < sea - 17 and deep_ocean >= 0:
			return deep_ocean
		if ocean >= 0:
			return ocean
	if h <= sea + 2:
		# Shore: river mouths stay river, everything else is beach.
		if terrain.river_at(wx, wz) > 0.5 and river >= 0:
			return river
		if beach >= 0:
			return beach
	if terrain.river_at(wx, wz) > 0.62 and h <= sea + 4 and river >= 0:
		return river
	var dist_sq := wx * wx + wz * wz
	if dist_sq < 400 * 400:
		return _at_earth_spawn(wx, wz, h, temp)
	if h > sea + 36 and mountains >= 0:
		return mountains
	return _climate_pick(wx, wz, temp, terrain.humidity_at(wx, wz))

## Around the origin the saga quests need plains + wasteland + forest (plus the bay that the
## height field already carves out for Kame House), so the climate map is replaced by a
## deterministic patchwork of those four.
func _at_earth_spawn(wx: int, wz: int, h: int, _temp: float) -> int:
	var sea := terrain.sea_level
	if h > sea + 40 and mountains >= 0:
		return mountains
	var z := terrain.zone_at(wx, wz)
	# A second, offset sample keeps the patches from being one big blob.
	var z2 := terrain.zone_at(wx + 5000, wz - 5000)
	if z > 0.16:
		return _spawn_waste if _spawn_waste >= 0 else default_index
	if z < -0.20:
		return _spawn_forest if _spawn_forest >= 0 else default_index
	if z2 > 0.42 and _spawn_sunflower >= 0:
		return _spawn_sunflower
	return _spawn_plains if _spawn_plains >= 0 else default_index

# --- Namek / Sacred --------------------------------------------------------

func _at_namek(wx: int, wz: int, h: int) -> int:
	var sea := terrain.sea_level
	var rivers := index_of("namekian_rivers")
	var rocky := index_of("namek_rocky")
	if h <= sea + 1 and rivers >= 0:
		return rivers
	if terrain.river_at(wx, wz) > 0.55 and rivers >= 0:
		return rivers
	if terrain.plateau_at(wx, wz) > 0.30 and rocky >= 0:
		return rocky
	var sacred := index_of("sacred_land")
	if sacred >= 0 and terrain.zone_at(wx, wz) > 0.52:
		return sacred
	var plains := index_of("ajissa_plains")
	return plains if plains >= 0 else default_index

func _at_sacred(wx: int, wz: int, h: int) -> int:
	var sea := terrain.sea_level
	var rivers := index_of("sacredkai_rivers")
	var hills := index_of("sacredkai_hills")
	if h <= sea + 1 and rivers >= 0:
		return rivers
	if terrain.river_at(wx, wz) > 0.55 and rivers >= 0:
		return rivers
	if h > sea + 18 and hills >= 0:
		return hills
	var sacred := index_of("sacred_land")
	if sacred >= 0 and terrain.zone_at(wx, wz) > 0.35:
		return sacred
	var plains := index_of("sacredkai_plains")
	return plains if plains >= 0 else default_index

# --- climate scoring -------------------------------------------------------

## Closest biome by (temperature, humidity); ties inside a band are broken by `weight` and a
## medium-scale zone noise so neighbouring patches differ.
func _climate_pick(wx: int, wz: int, temp: float, humid: float) -> int:
	var n := _pool_index.size()
	if n == 0:
		return default_index
	var best := 1e20
	for i in n:
		var dt := (temp - _pool_temp[i]) * 0.72
		var dh := humid - _pool_humid[i]
		var d := dt * dt + dh * dh
		if d < best:
			best = d
	var band := best + 0.30
	var total := 0.0
	for i in n:
		var dt2 := (temp - _pool_temp[i]) * 0.72
		var dh2 := humid - _pool_humid[i]
		if dt2 * dt2 + dh2 * dh2 <= band:
			total += _pool_weight[i]
	if total <= 0.0:
		return default_index
	var u := clampf(0.5 + 0.5 * terrain.zone_at(wx, wz), 0.0, 0.9999) * total
	var acc := 0.0
	for i in n:
		var dt3 := (temp - _pool_temp[i]) * 0.72
		var dh3 := humid - _pool_humid[i]
		if dt3 * dt3 + dh3 * dh3 > band:
			continue
		acc += _pool_weight[i]
		if u < acc:
			return _pool_index[i]
	return default_index
