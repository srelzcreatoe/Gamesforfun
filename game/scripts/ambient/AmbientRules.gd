class_name AmbientRules
## Pure decision layer for the ambient-life system: given a planet id, a biome definition,
## the time of day and the weather it answers "what is alive here, right now, and how much of it".
##
## Everything in this file is a static function of its arguments only (no nodes, no globals except
## the read-only Registry), so the whole behaviour of the system is unit-testable without a world.
## AmbientLife never decides anything itself; it only executes what these functions return.

# --- biome classes ----------------------------------------------------------------------------

enum Cls {
	BARREN,     ## rock/ash/wasteland: no plants worth animating
	PLAINS,     ## open grass + flowers
	FOREST,     ## trees with leaf canopies
	SWAMP,      ## wet, humid, mushrooms and lily pads
	SNOW,       ## snowy surface
	DESERT,     ## sand/dry, dust devils
	WATER,      ## ocean/river
	ALIEN,      ## namek / yardrat / sacred kai: green or exotic vegetation
	VOID,       ## deep space, orbit: nothing drifts here
}

## Planet moods. Drives firefly colour, shimmer and whether anything lives at all.
const MOOD_NORMAL := "normal"
const MOOD_NAMEK := "namek"
const MOOD_INFERNAL := "infernal"    ## Hell, Vampa: ember orange, heat shimmer
const MOOD_SPIRIT := "spirit"        ## Other World, Heaven, Sacred Kai: white motes
const MOOD_DEAD := "dead"            ## deep space / orbit / time chamber: nothing

const PLANET_MOOD := {
	"earth": MOOD_NORMAL,
	"namek": MOOD_NAMEK,
	"cereal": MOOD_NAMEK,
	"otherworld": MOOD_SPIRIT,
	"heaven": MOOD_SPIRIT,
	"sacred_kai_planet": MOOD_SPIRIT,
	"hell_planet": MOOD_INFERNAL,
	"vampa": MOOD_INFERNAL,
	"vegeta": MOOD_INFERNAL,
	"yardrat": MOOD_NORMAL,
	"time_chamber": MOOD_DEAD,
	"universe_7_deep_space": MOOD_DEAD,
	"orbit": MOOD_DEAD,
}

## Mote kinds a mote field can render.
const MOTE_NONE := ""
const MOTE_FIREFLY := "firefly"
const MOTE_POLLEN := "pollen"
const MOTE_DUST := "dust"
const MOTE_SNOW := "snow"
const MOTE_EMBER := "ember"
const MOTE_SPIRIT := "spirit"

const FLOWER_BLOCKS: Array[String] = [
	"dandelion", "poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip",
	"oxeye_daisy", "cornflower", "sunflower", "lilac", "rose_bush", "lavender",
	"chrysanthemum_flower", "amaryllis_flower", "marigold_flower", "catharanthus_roseus_flower",
	"trillium_flower", "lotus_flower", "sacred_chrysanthemum_flower", "sacred_trillium_flower",
]

## Entity kinds that leave a soul wisp when they die (humanoids, not frogs and dinosaurs).
const SOUL_KINDS: Array[String] = ["enemy", "master", "npc", "player"]

# --- time of day ------------------------------------------------------------------------------
# World.day_fraction(): 0.0 = 06:00 sunrise, 0.25 = noon, 0.5 = 18:00 sunset, 0.75 = midnight.

## 0 in broad daylight, 1 in the dead of night, smooth across dusk and dawn.
static func night_amount(day_fraction: float) -> float:
	var f := fposmod(day_fraction, 1.0)
	# Sun elevation proxy: +1 at noon, -1 at midnight.
	var elev := cos((f - 0.25) * TAU)
	return clampf(smoothstep(0.12, -0.16, elev), 0.0, 1.0)

static func is_night(day_fraction: float) -> bool:
	return night_amount(day_fraction) > 0.5

## 1 while the sun is high, 0 at night — the mirror of night_amount with a tighter curve.
static func day_amount(day_fraction: float) -> float:
	var f := fposmod(day_fraction, 1.0)
	var elev := cos((f - 0.25) * TAU)
	return clampf(smoothstep(-0.02, 0.28, elev), 0.0, 1.0)

## How far above/below the horizon the sun still counts as "twilight" (sun elevation proxy).
const TWILIGHT_BAND := 0.3

## Peaks at sunrise and sunset, 0 otherwise (distant flock silhouettes, horizon flashes).
static func twilight_amount(day_fraction: float) -> float:
	var f := fposmod(day_fraction, 1.0)
	var elev := cos((f - 0.25) * TAU)
	return clampf(1.0 - absf(elev) / TWILIGHT_BAND, 0.0, 1.0)

# --- weather ----------------------------------------------------------------------------------

static func is_wet(weather: String) -> bool:
	return weather == "rain" or weather == "thunder" or weather == "storm" or weather == "thunderstorm"

static func is_snowing(weather: String) -> bool:
	return weather == "snow"

## How hard the air is moving, 0..1. Rain and storms shake far more leaves loose.
static func weather_wind(weather: String) -> float:
	match weather:
		"rain": return 0.55
		"thunder", "storm", "thunderstorm": return 1.0
		"snow": return 0.3
		"overcast": return 0.15
		_: return 0.0

# --- biome classification ---------------------------------------------------------------------

## Classify a biome from its data/biomes.json definition (falls back to the id when the
## definition is missing, so an unknown biome still behaves sensibly).
static func classify(biome_id: String, def: Dictionary) -> int:
	var id := biome_id.to_lower()
	if id == "" and def.is_empty():
		return Cls.BARREN
	if id.contains("deep_space") or id.contains("asteroid") or id == "orbit":
		return Cls.VOID
	if id.contains("ocean") or id.contains("river") or id.contains("shores"):
		return Cls.WATER
	var surface := String(def.get("surface", "")).to_lower()
	var temp := float(def.get("temperature", 0.6))
	var humid := float(def.get("humidity", 0.5))
	if surface.contains("snow") or surface == "ice" or id.contains("snow") or id.contains("frozen") \
			or id.contains("ice_") or id.contains("sleeted") or temp <= 0.05:
		return Cls.SNOW
	if id.contains("swamp") or id.contains("marsh") or id.contains("wetland") or id.contains("mushroom_fields") \
			or (humid >= 0.85 and temp < 1.5 and id.contains("basin")):
		return Cls.SWAMP
	# A grass/moss surface is never a desert, however the planet's temperature is written down
	# (every Namek and Vampa biome claims temperature 2.0 and humidity 0.0).
	var grassy := surface.contains("grass") or surface.contains("moss") or surface.contains("podzol") \
			or surface.contains("mycelium") or surface.contains("cloud")
	if surface.contains("sand") or surface == "coarse_dirt" or id.contains("desert") or id.contains("dune") \
			or id.contains("badlands") or id.contains("dryland") or id.contains("xeric") \
			or id.contains("beach") or (temp >= 1.5 and humid <= 0.2 and not grassy):
		return Cls.DESERT
	if id.contains("wasteland") or id.contains("barren") or id.contains("peaks") or id.contains("cliffs") \
			or id.contains("slopes") or id.contains("mesa") or id.contains("rocky") \
			or id.contains("time_chamber") or id.contains("hyperbolic"):
		return Cls.BARREN
	var planet := String(def.get("planet", "earth"))
	var alien: bool = planet != "earth" and planet != "" and String(PLANET_MOOD.get(planet, MOOD_NORMAL)) != MOOD_NORMAL
	var trees: Array = def.get("trees", [])
	if trees.size() >= 1 and _woody(id, trees):
		return Cls.ALIEN if alien else Cls.FOREST
	if alien:
		return Cls.ALIEN
	return Cls.PLAINS

const WOODY_WORDS: Array[String] = [
	"forest", "jungle", "taiga", "woods", "woodland", "grove", "thicket", "covert",
	"wilds", "highlands", "bamboo", "cedar", "redwood", "aspen", "maple", "fir", "sugi",
	"wisteria", "cypress", "tropical", "savanna", "chaparral",
]

static func _woody(id: String, trees: Array) -> bool:
	for k in WOODY_WORDS:
		if id.contains(k):
			return true
	# Not named like a wood, but dense enough to have a canopy overhead.
	var density := 0.0
	for t in trees:
		if t is Dictionary:
			density += float((t as Dictionary).get("density", 0.0))
	return density >= 0.012

## True when the biome has flowers listed in data/biomes.json (butterflies want nectar).
static func has_flowers(def: Dictionary) -> bool:
	for p in def.get("plants", []):
		if p is Dictionary and FLOWER_BLOCKS.has(String((p as Dictionary).get("block", ""))):
			return true
	return false

static func has_grass(def: Dictionary) -> bool:
	for p in def.get("plants", []):
		if p is Dictionary:
			var b := String((p as Dictionary).get("block", ""))
			if b.contains("grass") or b.contains("fern"):
				return true
	return false

static func mood(planet_id: String) -> String:
	return String(PLANET_MOOD.get(planet_id, MOOD_NORMAL))

# --- what lives here --------------------------------------------------------------------------

## Fireflies: night only, in forests/swamps/plains (and alien vegetation). Rain puts them out.
## Colour is per planet mood: green on Namek, ember on Hell/Vampa, white in the Other World.
static func firefly_count(planet_id: String, cls: int, day_fraction: float, weather: String, max_count: int) -> int:
	var m := mood(planet_id)
	if m == MOOD_DEAD or cls == Cls.VOID:
		return 0
	var night := night_amount(day_fraction)
	if night < 0.25:
		return 0
	var base := 0.0
	match cls:
		Cls.FOREST: base = 1.0
		Cls.SWAMP: base = 1.0
		Cls.PLAINS: base = 0.6
		Cls.ALIEN: base = 0.85
		Cls.BARREN: base = 0.25 if m == MOOD_INFERNAL or m == MOOD_SPIRIT else 0.0
		Cls.DESERT: base = 0.2 if m == MOOD_INFERNAL else 0.0
		Cls.SNOW: base = 0.0
		Cls.WATER: base = 0.25
		_: base = 0.0
	if base <= 0.0:
		return 0
	if is_wet(weather):
		base *= 0.15
	elif is_snowing(weather):
		base *= 0.4
	return int(round(float(max_count) * base * night))

static func firefly_color(planet_id: String) -> Color:
	match mood(planet_id):
		MOOD_NAMEK: return Color(0.42, 1.0, 0.42)
		MOOD_INFERNAL: return Color(1.0, 0.47, 0.13)
		MOOD_SPIRIT: return Color(0.92, 0.96, 1.0)
		_: return Color(1.0, 0.92, 0.42)

## The daytime mote field: pollen over greenery, dust over sand, sparkle over snow,
## embers on Hell/Vampa (those burn day and night), white spirit motes in the afterlife.
static func mote_kind(planet_id: String, cls: int, day_fraction: float, weather: String) -> String:
	var m := mood(planet_id)
	if m == MOOD_DEAD or cls == Cls.VOID:
		return MOTE_NONE
	if m == MOOD_INFERNAL:
		return MOTE_EMBER
	if m == MOOD_SPIRIT:
		return MOTE_SPIRIT
	if cls == Cls.SNOW:
		# Snow only sparkles when the sun catches it.
		return MOTE_SNOW if day_amount(day_fraction) > 0.35 and not is_wet(weather) else MOTE_NONE
	if day_amount(day_fraction) < 0.3 or is_wet(weather):
		return MOTE_NONE
	match cls:
		Cls.DESERT: return MOTE_DUST
		Cls.WATER: return MOTE_NONE
		Cls.BARREN: return MOTE_DUST
		_: return MOTE_POLLEN

static func mote_color(kind: String) -> Color:
	match kind:
		MOTE_POLLEN: return Color(1.0, 0.94, 0.62)
		MOTE_DUST: return Color(0.95, 0.82, 0.6)
		MOTE_SNOW: return Color(0.88, 0.96, 1.0)
		MOTE_EMBER: return Color(1.0, 0.42, 0.12)
		MOTE_SPIRIT: return Color(0.88, 0.94, 1.0)
		_: return Color(1, 1, 1)

static func mote_count(kind: String, day_fraction: float, weather: String, max_count: int) -> int:
	if kind == MOTE_NONE:
		return 0
	var f := 1.0
	match kind:
		MOTE_POLLEN: f = 0.8 * day_amount(day_fraction)
		MOTE_DUST: f = 0.7 * day_amount(day_fraction)
		MOTE_SNOW: f = 0.9 * day_amount(day_fraction)
		MOTE_EMBER: f = 0.65
		MOTE_SPIRIT: f = 0.6
	if is_wet(weather) and kind != MOTE_EMBER:
		f *= 0.2
	return int(round(float(max_count) * clampf(f, 0.0, 1.0)))

## Leaves per second falling out of the canopy around the player.
static func leaf_rate(cls: int, weather: String, wind_gust: float) -> float:
	var base := 0.0
	match cls:
		Cls.FOREST: base = 3.0
		Cls.ALIEN: base = 2.0
		Cls.SWAMP: base = 1.4
		# A snowy taiga is still a wood: its firs shed, and without this a snow forest at night
		# (no fireflies, no sparkle until the sun is up) has nothing moving in it at all. The
		# leaf layer only ever parks under real leaf blocks, so this costs nothing on open snow.
		Cls.SNOW: base = 1.0
		Cls.PLAINS: base = 0.8
		_: base = 0.0
	if base <= 0.0:
		return 0.0
	var wind := maxf(clampf(wind_gust, 0.0, 1.0), weather_wind(weather))
	return base * (0.55 + 1.45 * wind)

static func butterfly_count(planet_id: String, cls: int, day_fraction: float, weather: String,
		flowers: bool, max_count: int) -> int:
	var m := mood(planet_id)
	if m == MOOD_DEAD or m == MOOD_INFERNAL or cls == Cls.VOID:
		return 0
	if is_wet(weather) or is_snowing(weather):
		return 0
	var day := day_amount(day_fraction)
	if day < 0.3:
		return 0
	var base := 0.0
	match cls:
		Cls.PLAINS: base = 1.0
		Cls.FOREST: base = 0.75
		Cls.ALIEN: base = 0.7
		Cls.SWAMP: base = 0.5
		_: base = 0.0
	if base <= 0.0:
		return 0
	if flowers:
		base *= 1.35
	return int(round(float(max_count) * clampf(base, 0.0, 1.0) * day))

## Birds fly by day. At dawn and dusk a second, far-away flock is drawn as a silhouette.
static func bird_flock_size(planet_id: String, cls: int, day_fraction: float, weather: String) -> int:
	var m := mood(planet_id)
	if m == MOOD_DEAD or cls == Cls.VOID:
		return 0
	if is_wet(weather):
		return 0
	if day_amount(day_fraction) < 0.25 and twilight_amount(day_fraction) < 0.3:
		return 0
	match cls:
		Cls.FOREST, Cls.PLAINS, Cls.SWAMP, Cls.WATER, Cls.ALIEN: return 5
		Cls.DESERT, Cls.BARREN, Cls.SNOW: return 3
		_: return 0

static func distant_flock_visible(planet_id: String, cls: int, day_fraction: float, weather: String) -> bool:
	if mood(planet_id) == MOOD_DEAD or cls == Cls.VOID or is_wet(weather):
		return false
	return twilight_amount(day_fraction) > 0.35

## Average seconds between shooting stars; <= 0 means none tonight.
static func shooting_star_interval(planet_id: String, cls: int, day_fraction: float, weather: String) -> float:
	if cls == Cls.VOID:
		return 3.0                      # deep space is nothing but streaking rocks
	if mood(planet_id) == MOOD_DEAD:
		return 0.0
	if night_amount(day_fraction) < 0.6 or is_wet(weather):
		return 0.0
	return 14.0

## Average seconds between distant horizon flashes (ki duels / heat lightning); <= 0 = none.
static func horizon_flash_interval(planet_id: String, day_fraction: float, weather: String) -> float:
	var m := mood(planet_id)
	if m == MOOD_DEAD:
		return 0.0
	if weather == "thunder" or weather == "storm" or weather == "thunderstorm":
		return 7.0
	if m == MOOD_INFERNAL:
		return 18.0
	if night_amount(day_fraction) > 0.6:
		return 40.0
	return 0.0

## Planets whose air visibly bakes, and how hard. Deliberately a per-planet table and NOT
## `mood == MOOD_INFERNAL`: Hell and Vampa are furnaces, but Planet Vegeta is a habitable (if
## harsh, red-sunned) world that shares the infernal *palette* — ember motes, orange haze —
## without shimmering like a lava field.
const SHIMMER_BY_PLANET := {
	"hell_planet": 1.0,
	"vampa": 1.0,
	"vegeta": 0.5,
}

## Heat shimmer strength 0..1: Hell and Vampa full strength, Vegeta half, any desert biome
## anywhere a mild ripple, everything else exactly 0 (and then the canvas pass stays hidden).
static func heat_shimmer(planet_id: String, cls: int) -> float:
	if SHIMMER_BY_PLANET.has(planet_id):
		return float(SHIMMER_BY_PLANET[planet_id])
	return 0.45 if cls == Cls.DESERT else 0.0

static func is_soul_kind(kind: String, height: float) -> bool:
	return SOUL_KINDS.has(kind) and height >= 1.2

## Ki wisp colour for a faction (villains burn purple, allies gold, wild things pale blue).
static func soul_color(faction: String) -> Color:
	match faction:
		"villain": return Color(0.75, 0.35, 1.0)
		"player", "z_fighter": return Color(1.0, 0.85, 0.45)
		_: return Color(0.55, 0.85, 1.0)
