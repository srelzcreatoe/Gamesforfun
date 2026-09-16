class_name Terrain
extends RefCounted
## Noise stacks and the per-planet height / climate fields (docs/briefs/worldgen.md §1).
##
## Everything in here is a *pure function* of (seed, world x, world z): the same seed and
## planet always produce the same value, no matter which column asks first or on which
## worker thread. Only `configure()` mutates state; after that the object is read-only and
## safe to sample from several WorkerThreadPool tasks at once.
##
## Height fields are continuous (no per-chunk decisions) so columns always agree at their
## borders. The Earth field carries a deterministic "spawn bias" that guarantees dry land at
## the origin and an ocean bay ~400 blocks away for Kame House.

const HEIGHT := WorldConst.HEIGHT

## Modes = planets.json `generator` values (plus "flat" for cloud planes).
const MODE_EARTH := "earth"
const MODE_NAMEK := "namek"
const MODE_SACRED := "sacred"
const MODE_VEGETA := "vegeta"
const MODE_YARDRAT := "yardrat"
const MODE_VAMPA := "vampa"
const MODE_CEREAL := "cereal"
const MODE_HELL := "hell"
const MODE_HEAVEN := "heaven"
const MODE_FLAT := "flat"

## planets.json `generator` -> terrain mode.
const MODES := {
	"earth": MODE_EARTH, "namek": MODE_NAMEK, "sacred": MODE_SACRED, "vegeta": MODE_VEGETA,
	"yardrat": MODE_YARDRAT, "vampa": MODE_VAMPA, "cereal": MODE_CEREAL, "hell": MODE_HELL,
	"heaven": MODE_HEAVEN, "otherworld": MODE_FLAT, "time_chamber": MODE_FLAT,
	"space": MODE_FLAT, "orbit": MODE_FLAT,
}

## Centre of the ocean bay the Earth height field always carves out (Kame House lives here).
const EARTH_BAY := Vector2(-300.0, 260.0)

var seed: int = 0
var planet_id := "earth"
var mode := MODE_EARTH
## Water surface for this planet (-999 = no oceans/seas at all).
var sea_level := WorldConst.SEA_LEVEL
var has_sea := true
## Floor / ceiling the height field is clamped to.
var min_height := 3
var max_height := HEIGHT - 12
## y of a flat plane for MODE_FLAT planets (otherworld / time chamber).
var plane_y := 60

var _cont := FastNoiseLite.new()      # continentalness (land vs ocean)
var _ero := FastNoiseLite.new()       # erosion (flat vs mountainous)
var _peaks := FastNoiseLite.new()     # ridged peaks / valleys
var _hills := FastNoiseLite.new()     # medium relief
var _detail := FastNoiseLite.new()    # 1-2 block surface detail
var _temp := FastNoiseLite.new()      # temperature
var _humid := FastNoiseLite.new()     # humidity
var _river := FastNoiseLite.new()     # river spine
var _zone := FastNoiseLite.new()      # biome patches near spawn / planet zoning
var _lake := FastNoiseLite.new()      # lake and pool basins
var _plateau := FastNoiseLite.new()   # mesa / plateau steps

## A Terrain configured like a planet's generator, for height queries without a generator
## (dragon ball placement, spawn points, tools). Kept here so nothing that only needs heights
## has to depend on the generator classes.
static func make(planet_def: Dictionary, p_seed: int) -> Terrain:
	var t := Terrain.new()
	var kind := String(planet_def.get("generator", "earth"))
	t.configure(p_seed, planet_def, String(MODES.get(kind, MODE_EARTH)))
	if kind == "otherworld" or kind == "time_chamber":
		t.plane_y = 60
	elif kind == "space" or kind == "orbit":
		t.plane_y = 0
	return t

func configure(p_seed: int, planet_def: Dictionary, p_mode: String) -> void:
	seed = p_seed
	planet_id = String(planet_def.get("id", "earth"))
	mode = p_mode
	var sl := int(planet_def.get("sea_level", WorldConst.SEA_LEVEL))
	has_sea = sl > 0 and sl < HEIGHT
	sea_level = sl if has_sea else -999
	_setup(_cont, FastNoiseLite.TYPE_SIMPLEX_SMOOTH, 0x1111, 0.0011, 4)
	_setup(_ero, FastNoiseLite.TYPE_SIMPLEX_SMOOTH, 0x2222, 0.0034, 3)
	_setup(_peaks, FastNoiseLite.TYPE_SIMPLEX, 0x3333, 0.0072, 4)
	_peaks.fractal_type = FastNoiseLite.FRACTAL_RIDGED
	_setup(_hills, FastNoiseLite.TYPE_SIMPLEX_SMOOTH, 0x4444, 0.0062, 3)
	_setup(_detail, FastNoiseLite.TYPE_SIMPLEX, 0x5555, 0.031, 2)
	_setup(_temp, FastNoiseLite.TYPE_SIMPLEX_SMOOTH, 0x6666, 0.00085, 2)
	_setup(_humid, FastNoiseLite.TYPE_SIMPLEX_SMOOTH, 0x7777, 0.00105, 2)
	_setup(_river, FastNoiseLite.TYPE_SIMPLEX_SMOOTH, 0x8888, 0.0013, 2)
	_setup(_zone, FastNoiseLite.TYPE_SIMPLEX_SMOOTH, 0x9999, 0.0055, 2)
	_setup(_lake, FastNoiseLite.TYPE_SIMPLEX_SMOOTH, 0xAAAA, 0.0042, 2)
	_setup(_plateau, FastNoiseLite.TYPE_SIMPLEX_SMOOTH, 0xBBBB, 0.0038, 2)

func _setup(n: FastNoiseLite, type: int, salt: int, freq: float, octaves: int) -> void:
	n.noise_type = type
	n.seed = seed + salt
	n.frequency = freq
	n.fractal_type = FastNoiseLite.FRACTAL_FBM
	n.fractal_octaves = octaves
	n.fractal_gain = 0.5
	n.fractal_lacunarity = 2.0

# --- climate ---------------------------------------------------------------

## Temperature in roughly -0.6 .. 2.0 (matches biomes.json `temperature`).
func temperature_at(wx: int, wz: int) -> float:
	var n := _temp.get_noise_2d(float(wx), float(wz))
	return 0.75 + n * 1.35

## Humidity in 0 .. 1 (matches biomes.json `humidity`).
func humidity_at(wx: int, wz: int) -> float:
	return clampf(0.5 + _humid.get_noise_2d(float(wx), float(wz)) * 0.95, 0.0, 1.0)

## Continentalness including the planet's spawn bias (-1 deep ocean .. 1 inland).
func continental_at(wx: int, wz: int) -> float:
	var c := _cont.get_noise_2d(float(wx), float(wz))
	if mode == MODE_EARTH:
		c += _bias_cont(float(wx), float(wz))
	return clampf(c, -1.0, 1.0)

## 1 on a river spine, 0 away from rivers.
func river_at(wx: int, wz: int) -> float:
	var rn := _river.get_noise_2d(float(wx), float(wz))
	return clampf(1.0 - absf(rn) * 11.0, 0.0, 1.0)

func zone_at(wx: int, wz: int) -> float:
	return _zone.get_noise_2d(float(wx), float(wz))

func erosion_at(wx: int, wz: int) -> float:
	return _ero.get_noise_2d(float(wx), float(wz))

func plateau_at(wx: int, wz: int) -> float:
	return _plateau.get_noise_2d(float(wx), float(wz))

## Lake/pool basin strength 0..1 (used by Vampa/Heaven/Hell pools).
func lake_at(wx: int, wz: int) -> float:
	var n := _lake.get_noise_2d(float(wx), float(wz))
	return clampf((n - 0.24) * 4.0, 0.0, 1.0)

# --- height ----------------------------------------------------------------

## Topmost solid y + 1 (i.e. the first air block) for this planet's terrain.
func height_at(wx: int, wz: int) -> int:
	return clampi(int(round(height_f(wx, wz))), min_height, max_height)

func height_f(wx: int, wz: int) -> float:
	var fx := float(wx)
	var fz := float(wz)
	match mode:
		MODE_EARTH: return _h_earth(fx, fz)
		MODE_NAMEK: return _h_namek(fx, fz)
		MODE_SACRED: return _h_sacred(fx, fz)
		MODE_VEGETA: return _h_vegeta(fx, fz)
		MODE_YARDRAT: return _h_yardrat(fx, fz)
		MODE_VAMPA: return _h_vampa(fx, fz)
		MODE_CEREAL: return _h_cereal(fx, fz)
		MODE_HELL: return _h_hell(fx, fz)
		MODE_HEAVEN: return _h_heaven(fx, fz)
		_: return float(plane_y)

# Earth: continentalness -> oceans, erosion -> relief amplitude, ridged peaks -> mountains,
# river spines carved to just under sea level, plus the spawn-area bias.
func _h_earth(fx: float, fz: float) -> float:
	var sea := float(sea_level)
	var c := clampf(_cont.get_noise_2d(fx, fz) + _bias_cont(fx, fz), -1.0, 1.0)
	var land := smoothstep(-0.17, 0.07, c)
	var hc := lerpf(sea - 27.0, sea + 7.0, land)
	var ero := _ero.get_noise_2d(fx, fz)
	var flat := clampf(0.5 + 0.5 * ero, 0.0, 1.0)
	var amp := land * lerpf(36.0, 5.0, flat)
	var hills := 0.5 + 0.5 * _hills.get_noise_2d(fx, fz)
	var ridge := 1.0 - absf(_peaks.get_noise_2d(fx, fz))
	var relief := 0.55 * hills + 0.45 * ridge * ridge
	var h := hc + amp * relief + _detail.get_noise_2d(fx, fz) * 2.1 + _bias_height(fx, fz)
	# Rivers: cut a valley to just below sea level, except through high mountains.
	var rn := _river.get_noise_2d(fx, fz)
	var river := clampf(1.0 - absf(rn) * 11.0, 0.0, 1.0)
	if river > 0.0 and land > 0.35:
		var mtn := clampf((h - (sea + 30.0)) / 22.0, 0.0, 1.0)
		# Never carve a river through the spawn area (the saga starts there on foot).
		var guard := _gauss(fx, fz, 0.0, 0.0, 130.0)
		var rs := river * river * (1.0 - mtn) * land * clampf(1.0 - guard * 1.6, 0.0, 1.0)
		h = lerpf(h, minf(h, sea - 2.0), rs)
	return h

## Continentalness bias: dry land at the origin, an ocean bay for Kame House.
func _bias_cont(fx: float, fz: float) -> float:
	var b := 0.0
	b += 0.55 * _gauss(fx, fz, 0.0, 0.0, 170.0)
	b -= 1.15 * _gauss(fx, fz, -300.0, 260.0, 190.0)
	return b

func _bias_height(fx: float, fz: float) -> float:
	var b := 0.0
	b += 9.0 * _gauss(fx, fz, 0.0, 0.0, 150.0)
	b -= 26.0 * _gauss(fx, fz, -300.0, 260.0, 190.0)
	return b

static func _gauss(fx: float, fz: float, cx: float, cz: float, r: float) -> float:
	var dx := fx - cx
	var dz := fz - cz
	return exp(-(dx * dx + dz * dz) / (2.0 * r * r))

# Namek: broad green plains, rocky highlands, shallow seas and river valleys.
func _h_namek(fx: float, fz: float) -> float:
	var sea := float(sea_level)
	var c := _cont.get_noise_2d(fx, fz)
	var h := sea + 3.0 + 7.0 * _hills.get_noise_2d(fx, fz) + 2.0 * _detail.get_noise_2d(fx, fz)
	if c < -0.12:
		h -= (-0.12 - c) * 46.0                       # lakes and seas
	var rocky := _plateau.get_noise_2d(fx, fz)
	if rocky > 0.28:
		var t := (rocky - 0.28) / 0.72
		h += t * t * 34.0 + 6.0 * (1.0 - absf(_peaks.get_noise_2d(fx, fz))) * t
	var river := clampf(1.0 - absf(_river.get_noise_2d(fx, fz)) * 13.0, 0.0, 1.0)
	if river > 0.0 and h > sea - 3.0 and rocky < 0.28:
		h = lerpf(h, sea - 2.0, river * river)
	return h

# Sacred World of the Kai: soft rolling hills, wide rivers.
func _h_sacred(fx: float, fz: float) -> float:
	var sea := float(sea_level)
	var h := sea + 4.0 + 9.0 * _hills.get_noise_2d(fx, fz) + 1.8 * _detail.get_noise_2d(fx, fz)
	var hilly := _plateau.get_noise_2d(fx, fz)
	if hilly > 0.2:
		h += (hilly - 0.2) * 30.0
	var river := clampf(1.0 - absf(_river.get_noise_2d(fx, fz)) * 9.0, 0.0, 1.0)
	if river > 0.0:
		h = lerpf(h, sea - 2.0, river * river * 0.95)
	return h

# Vegeta: quantised rocky mesas with red sand flats between them.
func _h_vegeta(fx: float, fz: float) -> float:
	var base := 58.0 + 8.0 * _cont.get_noise_2d(fx, fz)
	var step := _plateau.get_noise_2d(fx, fz)
	var tiers := floorf((step * 0.5 + 0.5) * 4.0)
	var h := base + tiers * 7.0
	var ridge := 1.0 - absf(_peaks.get_noise_2d(fx, fz))
	h += ridge * ridge * 9.0 * clampf(step + 0.4, 0.0, 1.0)
	h += _detail.get_noise_2d(fx, fz) * 2.4
	return h

# Yardrat: gentle rolling purple hills.
func _h_yardrat(fx: float, fz: float) -> float:
	var h := 62.0 + 10.0 * _hills.get_noise_2d(fx, fz) + 5.0 * _cont.get_noise_2d(fx, fz)
	h += 2.2 * _detail.get_noise_2d(fx, fz)
	return h

# Vampa: crescent dunes plus a few shallow basins.
func _h_vampa(fx: float, fz: float) -> float:
	var warp := _cont.get_noise_2d(fx, fz)
	var dune := 0.5 + 0.5 * sin((fx + 60.0 * warp) * 0.055 + 2.2 * _hills.get_noise_2d(fx, fz))
	var h := 58.0 + 7.0 * dune + 6.0 * _hills.get_noise_2d(fx, fz) + 1.5 * _detail.get_noise_2d(fx, fz)
	var basin := lake_at(int(fx), int(fz))
	h -= basin * 9.0
	return h

# Cereal: banded mesas, steep sided, with sand flats.
func _h_cereal(fx: float, fz: float) -> float:
	var base := 56.0 + 6.0 * _cont.get_noise_2d(fx, fz)
	var m := _plateau.get_noise_2d(fx, fz)
	var h := base
	if m > 0.0:
		var t := smoothstep(0.0, 0.16, m)
		var tiers := floorf(m * 5.0)
		h += t * (10.0 + tiers * 6.0)
	h += 1.8 * _detail.get_noise_2d(fx, fz) + 3.0 * _hills.get_noise_2d(fx, fz)
	return h

# Hell: broken rock shelves with molten pools in the hollows.
func _h_hell(fx: float, fz: float) -> float:
	var ridge := 1.0 - absf(_peaks.get_noise_2d(fx, fz))
	var h := 58.0 + 12.0 * _cont.get_noise_2d(fx, fz) + 10.0 * ridge * ridge
	h += 3.0 * _detail.get_noise_2d(fx, fz)
	h -= lake_at(int(fx), int(fz)) * 7.0
	return h

# Heaven: soft meadows with shallow ponds.
func _h_heaven(fx: float, fz: float) -> float:
	var h := 62.0 + 7.0 * _hills.get_noise_2d(fx, fz) + 4.0 * _cont.get_noise_2d(fx, fz)
	h += 1.4 * _detail.get_noise_2d(fx, fz)
	h -= lake_at(int(fx), int(fz)) * 8.0
	return h

# --- deterministic hashing -------------------------------------------------

## Stable 31-bit hash of an integer triple plus this terrain's seed.
func hash3(x: int, y: int, z: int) -> int:
	return hash_seeded(seed, x, y, z)

static func hash_seeded(s: int, x: int, y: int, z: int) -> int:
	var h: int = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ (s * 374761393)
	h = (h ^ (h >> 13)) * 1274126177
	return (h ^ (h >> 16)) & 0x7fffffff

## Deterministic float in [0, 1).
static func hash_unit(s: int, x: int, y: int, z: int) -> float:
	return float(hash_seeded(s, x, y, z) & 0xFFFFFF) / 16777216.0
