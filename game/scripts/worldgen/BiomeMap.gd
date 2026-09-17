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
## Elevation band -> indices into the pool arrays (Terralith-style band placement).
var _bands: Dictionary = {}
## y thresholds for the bands.
var band_peak := 104
var band_high := 88
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
	var elevations := PackedStringArray()
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
		var el := String(def.get("elevation", "mountains" if bid == "mountains" else "mid"))
		if el == "mountains":
			el = "high"
		elevations.append(el)
	# Which biomes may appear in which height band (each band also takes its neighbour band,
	# so forests climb into the hills and alpine biomes reach down the slopes).
	_bands = {}
	for band in ["low", "mid", "high", "peak"]:
		var allow: Array = {"low": ["low", "mid"], "mid": ["mid", "low"],
			"high": ["high", "mid"], "peak": ["peak", "high"]}[band]
		var list := PackedInt32Array()
		for i in elevations.size():
			if elevations[i] in allow or elevations[i] == "any":
				list.append(i)
		if list.is_empty():
			for i in elevations.size():
				list.append(i)
		_bands[band] = list

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

## Rule-driven biome (ocean / shore / river / spawn zone), or -1 when the climate pick decides.
## Splitting it this way lets WorldGen cache the expensive climate pick per 4x4 cell the way
## vanilla does, while shorelines stay crisp per block.
func rules_at(wx: int, wz: int, h: int) -> int:
	if _hot_radius > 0.0 and _hot_biome >= 0:
		var dx := float(wx) - _hot_center.x
		var dz := float(wz) - _hot_center.y
		if dx * dx + dz * dz <= _hot_radius * _hot_radius:
			return _hot_biome
	if style != STYLE_EARTH:
		return at(wx, wz, h)
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
		if terrain.river_at(wx, wz) > 0.5 and river >= 0:
			return river
		if temp > 1.4:
			var tropical := index_of("tropical_shores")
			if tropical >= 0:
				return tropical
		if beach >= 0:
			return beach
	if terrain.river_at(wx, wz) > 0.62 and h <= sea + 4 and river >= 0:
		return river
	if wx * wx + wz * wz < 400 * 400 and h < band_high:
		return _at_earth_spawn(wx, wz, h, temp)
	return -1

## Band index of a height: 0 low, 1 mid, 2 high, 3 peak.
func band_index(h: int) -> int:
	if h >= band_peak:
		return 3
	if h >= band_high:
		return 2
	return 1 if h >= terrain.sea_level + 7 else 0

const BAND_NAMES := ["low", "mid", "high", "peak"]

## The climate half of the Earth selection, for a band index from `band_index()`.
func pick_band(wx: int, wz: int, band: int) -> int:
	return _climate_pick(wx, wz, terrain.temperature_at(wx, wz), terrain.humidity_at(wx, wz),
		BAND_NAMES[clampi(band, 0, 3)])

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
	var ruled := rules_at(wx, wz, h)
	if ruled >= 0:
		return ruled
	return pick_band(wx, wz, band_index(h))

func _at_earth_full(wx: int, wz: int, h: int) -> int:
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
		# Shore: river mouths stay river, hot coasts get palm shores, the rest is beach.
		if terrain.river_at(wx, wz) > 0.5 and river >= 0:
			return river
		if temp > 1.4:
			var tropical := index_of("tropical_shores")
			if tropical >= 0:
				return tropical
		if beach >= 0:
			return beach
	if terrain.river_at(wx, wz) > 0.62 and h <= sea + 4 and river >= 0:
		return river
	var dist_sq := wx * wx + wz * wz
	if dist_sq < 400 * 400:
		return _at_earth_spawn(wx, wz, h, temp)
	return _climate_pick(wx, wz, temp, terrain.humidity_at(wx, wz), _band_of(h, sea))

## Around the origin the saga quests need plains + wasteland + forest (plus the bay that the
## height field already carves out for Kame House), so the climate map is replaced by a
## deterministic patchwork of those four.
func _band_of(h: int, sea: int) -> String:
	if h >= band_peak:
		return "peak"
	if h >= band_high:
		return "high"
	if h >= sea + 7:
		return "mid"
	return "low"

func _at_earth_spawn(wx: int, wz: int, h: int, temp: float) -> int:
	var sea := terrain.sea_level
	if h >= band_high:
		return _climate_pick(wx, wz, temp, terrain.humidity_at(wx, wz), _band_of(h, sea))
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
func _climate_pick(wx: int, wz: int, temp: float, humid: float, band := "") -> int:
	var pool: PackedInt32Array = _bands.get(band, PackedInt32Array()) if band != "" else PackedInt32Array()
	if pool.is_empty():
		pool = PackedInt32Array()
		for i in _pool_index.size():
			pool.append(i)
	var n := pool.size()
	if n == 0:
		return default_index
	var best := 1e20
	for k in n:
		var i := pool[k]
		var dt := (temp - _pool_temp[i]) * 0.72
		var dh := humid - _pool_humid[i]
		var d := dt * dt + dh * dh
		if d < best:
			best = d
	var window := best + 0.22
	var total := 0.0
	for k in n:
		var i2 := pool[k]
		var dt2 := (temp - _pool_temp[i2]) * 0.72
		var dh2 := humid - _pool_humid[i2]
		if dt2 * dt2 + dh2 * dh2 <= window:
			total += _pool_weight[i2]
	if total <= 0.0:
		return default_index
	# two offset zone samples so neighbouring patches of the same climate differ
	var u := clampf(0.5 + 0.35 * terrain.zone_at(wx, wz)
		+ 0.15 * terrain.zone_at(wx + 3300, wz - 2100), 0.0, 0.9999) * total
	var acc := 0.0
	for k in n:
		var i3 := pool[k]
		var dt3 := (temp - _pool_temp[i3]) * 0.72
		var dh3 := humid - _pool_humid[i3]
		if dt3 * dt3 + dh3 * dh3 > window:
			continue
		acc += _pool_weight[i3]
		if u < acc:
			return _pool_index[i3]
	return default_index
