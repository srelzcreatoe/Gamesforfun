class_name DragonBallPlacement
extends RefCounted
## Deterministic dragon ball positions per set (docs/briefs/worldgen.md §5).
##
## `positions(set_id, seed)` is the public API the quests engineer's DragonBalls manager and
## the radar use; the generator calls `place_in_column()` which drops the balls that fall into
## the column being generated into `entities_pending` as
## `{type: "dragon_ball", pos, data: {set, star}}`.
##
## Positions are a pure function of (set, seed): a seeded angle/distance per star, pushed to
## the first candidate that is on dry land (or floating for the space sets).

const SETS := {
	"earth": {"planet": "earth", "count": 7, "min": 200, "range": 1500},
	"namek": {"planet": "namek", "count": 7, "min": 180, "range": 1200},
	"super": {"planet": "universe_7_deep_space", "count": 7, "min": 400, "range": 3000},
	"cereal": {"planet": "cereal", "count": 2, "min": 150, "range": 900},
}
## Retries per ball while looking for dry land.
const TRIES := 24

static var _cache: Dictionary = {}
static var _mutex := Mutex.new()

## World positions (feet centre) of every ball of a set, index 0 = 1 star.
static func positions(set_id: String, seed: int) -> Array[Vector3]:
	var key := "%s|%d" % [set_id, seed]
	_mutex.lock()
	var hit: Variant = _cache.get(key, null)
	_mutex.unlock()
	if hit != null:
		var cached: Array[Vector3] = []
		cached.assign(hit)
		return cached
	var out := _compute(set_id, seed)
	_mutex.lock()
	_cache[key] = out
	_mutex.unlock()
	return out

static func planet_of(set_id: String) -> String:
	var def: Dictionary = SETS.get(set_id, {})
	return String(def.get("planet", ""))

static func count_of(set_id: String) -> int:
	var def: Dictionary = SETS.get(set_id, {})
	return int(def.get("count", 7))

static func _compute(set_id: String, seed: int) -> Array[Vector3]:
	var out: Array[Vector3] = []
	var def: Dictionary = SETS.get(set_id, {})
	if def.is_empty():
		return out
	var planet_id := String(def["planet"])
	var planet_def := Registry.planet(planet_id)
	var terrain := WorldGenFactory.make_terrain(planet_def, seed)
	var count := int(def["count"])
	var min_d := float(def["min"])
	var max_d := float(def["range"])
	var floating: bool = String(planet_def.get("generator", "")) in ["space", "orbit"]
	for star in range(1, count + 1):
		var pos := Vector3.ZERO
		for t in TRIES:
			var hh := Terrain.hash_seeded(seed + 55501, star, 7 + t, 13)
			var ang := (float(hh % 65536) / 65536.0) * TAU
			var dist: float = min_d + (float((hh >> 16) & 0xffff) / 65536.0) * (max_d - min_d)
			var x := int(round(cos(ang) * dist))
			var z := int(round(sin(ang) * dist))
			if floating:
				var y := 48 + ((hh >> 9) % 64)
				pos = Vector3(float(x) + 0.5, float(y), float(z) + 0.5)
				break
			var h := terrain.height_at(x, z)
			if terrain.has_sea and h <= terrain.sea_level + 1 and t < TRIES - 1:
				continue
			pos = Vector3(float(x) + 0.5, float(h), float(z) + 0.5)
			break
		out.append(pos)
	return out

## Drop the balls of `set_id` that belong to this column into entities_pending.
static func place_in_column(col: ChunkColumn, ctx: WorldGen.Ctx, set_id: String, gen: WorldGen) -> void:
	var list := positions(set_id, gen.seed)
	for i in list.size():
		var p: Vector3 = list[i]
		var wx := int(floor(p.x))
		var wz := int(floor(p.z))
		if not gen.inside(ctx, wx, wz):
			continue
		var y := p.y
		if gen.has_sea or gen.terrain.mode != Terrain.MODE_FLAT:
			y = float(maxi(int(p.y), ctx.top_any[(wx - ctx.ox) + 16 * (wz - ctx.oz)]))
		col.entities_pending.append({
			"type": "dragon_ball",
			"pos": Vector3(p.x, y, p.z),
			"data": {"set": set_id, "star": i + 1},
		})
