class_name OtherworldGen
extends WorldGen
## Other World: an endless otherworld_cloud plain with the Check-In Station on it, Snake Way
## winding away from the station toward King Kai's planet (a floating sphere structure) and
## nothing below the clouds (docs/briefs/worldgen.md §3).

const PLANE := 60
## Snake Way: half width of the road, railing height, cruise altitude above the clouds.
const ROAD_HALF := 2
const ROAD_Y := PLANE + 10

var station_pos := Vector2i(0, 16)
var kk_pos := Vector2i(1100, 0)
var _road := FastNoiseLite.new()

func _configure() -> void:
	terrain_mode = Terrain.MODE_FLAT
	biome_style = BiomeMap.STYLE_SINGLE
	caves_enabled = false
	decorate = false
	# the Check-In Station contains the spawn, so it may cover the clearing (the arrival point still gets head room).
	structures_avoid_spawn = false
	stone_name = "otherworld_cloud"
	bedrock_depth = 0
	dragon_ball_set = ""
	ore_table = []

func plane_y() -> int:
	return PLANE

func _post_configure() -> void:
	_road.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_road.seed = seed + 0x5A11
	_road.frequency = 0.004
	var ang := Terrain.hash_unit(seed, 3, 1, 4) * TAU
	kk_pos = Vector2i(int(round(cos(ang) * 1100.0)), int(round(sin(ang) * 1100.0)))
	biome_map.set_hotspot(Vector2(kk_pos), 34.0, "king_kai_planet")
	structures.set_unique("king_kai_planet", Vector3i(kk_pos.x, 0, kk_pos.y))
	structures.set_unique("check_in_station", Vector3i(station_pos.x, 0, station_pos.y))

## Structure y values come from the DMZ dimension where the cloud floor is at y 40.
func remap_structure_y(y: int, mode: String) -> int:
	if mode == "sky":
		return 92
	return PLANE + 1 + (y - 40)

## Flat cloud floor, air everywhere else.
func _fill_column(col: ChunkColumn, ctx: Ctx) -> void:
	var blocks := col.blocks
	var bio := col.biomes
	var cloud := block_id("otherworld_cloud")
	var floor_bottom: int = maxi(0, PLANE - 7)
	for lz in 16:
		for lx in 16:
			var i2 := lx + 16 * lz
			bio[i2] = maxi(0, ext_biome(ctx, lx, lz)) & 255
			for y in range(floor_bottom, PLANE + 1):
				blocks[i2 + 256 * y] = cloud
			ctx.tops[i2] = PLANE + 1
			ctx.top_any[i2] = PLANE + 1
			ctx.wet[i2] = 0
	col.blocks = blocks
	col.biomes = bio

func _features(col: ChunkColumn, ctx: Ctx) -> void:
	_snake_way(col, ctx)

## Snake Way: a 5 wide road with railings that leaves the Check-In Station and wiggles all the
## way to King Kai's planet, rising to the planet's altitude at the end.
func _snake_way(col: ChunkColumn, ctx: Ctx) -> void:
	var road := block_id("snake_way")
	var edge := block_id("snake_way_edge")
	if road <= 0:
		return
	if edge <= 0:
		edge = road
	var a := Vector2(station_pos)
	var b := Vector2(kk_pos)
	var axis := b - a
	var length := axis.length()
	if length < 1.0:
		return
	var dir := axis / length
	var perp := Vector2(-dir.y, dir.x)
	var center := Vector2(float(ctx.ox) + 8.0, float(ctx.oz) + 8.0)
	var t_mid: float = (center - a).dot(dir)
	var t0: float = maxf(0.0, t_mid - 90.0)
	var t1: float = minf(length, t_mid + 90.0)
	if t1 <= t0:
		return
	var t := t0
	while t <= t1:
		var lateral := 34.0 * sin(t * 0.0165) + 22.0 * _road.get_noise_2d(t, 0.0)
		var p := a + dir * t + perp * lateral
		var wx := int(round(p.x))
		var wz := int(round(p.y))
		if wx + 6 < ctx.ox or wx - 6 >= ctx.ox + 16 or wz + 6 < ctx.oz or wz - 6 >= ctx.oz + 16:
			t += 0.5
			continue
		var y := ROAD_Y + int(round(3.0 * sin(t * 0.03)))
		if t > length - 120.0:
			var k: float = clampf((t - (length - 120.0)) / 120.0, 0.0, 1.0)
			y = int(round(lerpf(float(y), 86.0, k)))
		y = clampi(y, 2, HEIGHT - 3)
		# cross section: road deck + railings
		for w in range(-ROAD_HALF, ROAD_HALF + 1):
			var q := p + perp * float(w)
			var qx := int(round(q.x))
			var qz := int(round(q.y))
			if absi(w) == ROAD_HALF:
				put_world(col, ctx, qx, y, qz, edge)
				put_world(col, ctx, qx, y + 1, qz, edge)
			else:
				put_world(col, ctx, qx, y, qz, road)
			# keep the deck watertight where the path turns
			put_world(col, ctx, qx, y - 1, qz, road)
		t += 0.5
