class_name ChunkMesher
## Turns voxels into ArrayMesh surface arrays on WorkerThreadPool threads.
##
## Pipeline: the main thread calls `snapshot()` on a 3x3 neighbourhood of columns (it copies
## their packed arrays, so nothing is shared with the live columns), then a worker turns that
## into a padded (18 x 18 x HEIGHT+2) block/meta/light/biome array with `build_pad()` and meshes
## every dirty section from it with `build_section()`.
##
## Vertex layout (docs/ARCHITECTURE.md §4):
##   POSITION  column-local metres (x/z 0..16, y absolute)
##   NORMAL    face normal (the shader derives the face brightness from it)
##   UV        0..1 tile uv
##   UV2       x = texture array layer + (frames + sway * 64) / 128  (see _layer_uv),
##             y = packed_light / 255 with packed_light = sky * 16 + block
##   COLOR     rgb = biome/liquid tint, a = ambient occlusion (0.55 / 0.7 / 0.85 / 1.0)
##
## Four surfaces come out: "opaque", "cutout" (alpha scissor), "water" (translucent) and
## "lava" (same water shader with is_lava = 1, so it does not get waves or a sky reflection).

const PAD := 18
const HEIGHT := WorldConst.HEIGHT
const AO := [0.55, 0.7, 0.85, 1.0]
const WATER_COLOR := Color(0.247, 0.463, 0.894)      # #3F76E4
const GRASS_FALLBACK := Color(0.569, 0.741, 0.349)   # #91BD59
const FOLIAGE_FALLBACK := Color(0.467, 0.671, 0.184) # #77AB2F

enum { S_OPAQUE, S_CUTOUT, S_WATER, S_LAVA }

## Reused per-block cursor (one instance per mesh job, no allocation per voxel).
class Ctx:
	var blocks := PackedByteArray()
	var meta := PackedByteArray()
	var light := PackedByteArray()
	var plane := 0
	var i := 0
	var lx := 0
	var ly := 0
	var lz := 0
	var wx := 0
	var wy := 0
	var wz := 0
	var id := 0
	var m := 0
	var grass := GRASS_FALLBACK
	var foliage := FOLIAGE_FALLBACK
	var water := WATER_COLOR
	## Hoisted lookup tables (BlockTable statics + the AO offset table), so the inner loops
	## never touch a static var or recompute an index.
	var full := PackedByteArray()
	var opaque := PackedByteArray()
	var ao_off := PackedInt32Array()

	func at(dx: int, dy: int, dz: int) -> int:
		return blocks[i + dx + dz * PAD + dy * plane]

	func meta_at(dx: int, dy: int, dz: int) -> int:
		return meta[i + dx + dz * PAD + dy * plane]

class Buf:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var uv := PackedVector2Array()
	var uv2 := PackedVector2Array()
	var c := PackedColorArray()
	var idx := PackedInt32Array()

	func quad(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, nrm: Vector3,
			u0: Vector2, u1: Vector2, u2: Vector2, u3: Vector2,
			layer: float, l0: float, l1: float, l2: float, l3: float,
			a0: float, a1: float, a2: float, a3: float, tint: Color) -> void:
		var b := v.size()
		v.push_back(p0); v.push_back(p1); v.push_back(p2); v.push_back(p3)
		n.push_back(nrm); n.push_back(nrm); n.push_back(nrm); n.push_back(nrm)
		uv.push_back(u0); uv.push_back(u1); uv.push_back(u2); uv.push_back(u3)
		uv2.push_back(Vector2(layer, l0)); uv2.push_back(Vector2(layer, l1))
		uv2.push_back(Vector2(layer, l2)); uv2.push_back(Vector2(layer, l3))
		c.push_back(Color(tint.r, tint.g, tint.b, a0)); c.push_back(Color(tint.r, tint.g, tint.b, a1))
		c.push_back(Color(tint.r, tint.g, tint.b, a2)); c.push_back(Color(tint.r, tint.g, tint.b, a3))
		if a0 + a2 > a1 + a3:
			# Flip the split so ambient occlusion does not look anisotropic.
			idx.push_back(b + 1); idx.push_back(b + 2); idx.push_back(b + 3)
			idx.push_back(b + 1); idx.push_back(b + 3); idx.push_back(b)
		else:
			idx.push_back(b); idx.push_back(b + 1); idx.push_back(b + 2)
			idx.push_back(b); idx.push_back(b + 2); idx.push_back(b + 3)

	func is_empty() -> bool:
		return idx.is_empty()

	func to_arrays() -> Array:
		var a := []
		a.resize(Mesh.ARRAY_MAX)
		a[Mesh.ARRAY_VERTEX] = v
		a[Mesh.ARRAY_NORMAL] = n
		a[Mesh.ARRAY_TEX_UV] = uv
		a[Mesh.ARRAY_TEX_UV2] = uv2
		a[Mesh.ARRAY_COLOR] = c
		a[Mesh.ARRAY_INDEX] = idx
		return a

# --- snapshot ---------------------------------------------------------------

## Take the immutable snapshot of a 3x3 neighbourhood. MAIN THREAD ONLY: the packed arrays are
## duplicated here so the worker owns them outright. Sharing them copy-on-write with a live
## ChunkColumn is not thread safe (the main thread relights columns while a worker meshes).
## `cols`: 9 ChunkColumn or null, index = (dz + 1) * 3 + (dx + 1), centre at 4.
static func snapshot(cols: Array) -> Array:
	var out: Array = []
	out.resize(9)
	for i in 9:
		var col: ChunkColumn = cols[i]
		if col == null:
			out[i] = null
			continue
		out[i] = {
			"cx": col.cx, "cz": col.cz,
			"blocks": col.blocks.duplicate(), "meta": col.meta.duplicate(),
			"light": col.light.duplicate(), "biomes": col.biomes.duplicate(),
		}
	return out

## Flatten a snapshot into padded (18 x 18 x HEIGHT + 2) arrays for the centre column.
static func build_pad(snaps: Array) -> Dictionary:
	var centre: Dictionary = snaps[4]
	var plane := PAD * PAD
	var blocks := PackedByteArray()
	var metas := PackedByteArray()
	var lights := PackedByteArray()
	var biome := PackedByteArray()
	blocks.resize(plane * (HEIGHT + 2))
	metas.resize(plane * (HEIGHT + 2))
	lights.resize(plane * (HEIGHT + 2))
	biome.resize(plane)
	var src_blocks: Array = []
	var src_meta: Array = []
	var src_light: Array = []
	var src_base := PackedInt32Array()
	src_blocks.resize(plane); src_meta.resize(plane); src_light.resize(plane); src_base.resize(plane)
	for pz in PAD:
		for px in PAD:
			var x := px - 1
			var z := pz - 1
			var dx := -1 if x < 0 else (1 if x > 15 else 0)
			var dz := -1 if z < 0 else (1 if z > 15 else 0)
			var snap: Variant = snaps[(dz + 1) * 3 + (dx + 1)]
			var pi := pz * PAD + px
			if snap == null:
				continue
			var d: Dictionary = snap
			src_blocks[pi] = d["blocks"]
			src_meta[pi] = d["meta"]
			src_light[pi] = d["light"]
			var lx := x & 15
			var lz := z & 15
			src_base[pi] = lx + 16 * lz
			biome[pi] = (d["biomes"] as PackedByteArray)[lx + 16 * lz]
	# y = -1 stays air/dark; y = HEIGHT is open sky.
	for pi in plane:
		lights[(HEIGHT + 1) * plane + pi] = 0xF0
	for y in HEIGHT:
		var row := (y + 1) * plane
		var yoff := 256 * y
		for pi in plane:
			var sb: Variant = src_blocks[pi]
			if sb == null:
				lights[row + pi] = 0xF0
				continue
			var si: int = src_base[pi] + yoff
			blocks[row + pi] = (sb as PackedByteArray)[si]
			metas[row + pi] = (src_meta[pi] as PackedByteArray)[si]
			lights[row + pi] = (src_light[pi] as PackedByteArray)[si]
	return {
		"cx": int(centre["cx"]), "cz": int(centre["cz"]),
		"blocks": blocks, "meta": metas, "light": lights, "biome": biome,
	}

## Precomputed pad-index offsets for per-vertex AO / smooth light:
## index = ((face * 4 + corner) * 4 + j), j = 0 outward cell, 1 and 2 the two side cells,
## 3 the diagonal cell. PAD and the plane stride are constants, so these never change.
static func ao_offsets() -> PackedInt32Array:
	var plane := PAD * PAD
	var out := PackedInt32Array()
	out.resize(6 * 4 * 4)
	for f in 6:
		var axis := f >> 1
		var sgn := 1 if (f & 1) == 0 else -1
		var corners: Array = BlockShapes.FACE_CORNERS[f]
		for k in 4:
			var uc: Vector3 = corners[k]
			var n := [0, 0, 0]
			var t1 := [0, 0, 0]
			var t2 := [0, 0, 0]
			n[axis] = sgn
			var d := [1 if uc.x > 0.5 else -1, 1 if uc.y > 0.5 else -1, 1 if uc.z > 0.5 else -1]
			var first := true
			for a in 3:
				if a == axis:
					continue
				if first:
					t1[a] = d[a]
					first = false
				else:
					t2[a] = d[a]
			var base := (f * 4 + k) * 4
			out[base + 0] = n[0] + n[2] * PAD + n[1] * plane
			out[base + 1] = (n[0] + t1[0]) + (n[2] + t1[2]) * PAD + (n[1] + t1[1]) * plane
			out[base + 2] = (n[0] + t2[0]) + (n[2] + t2[2]) * PAD + (n[1] + t2[1]) * plane
			out[base + 3] = (n[0] + t1[0] + t2[0]) + (n[2] + t1[2] + t2[2]) * PAD + (n[1] + t1[1] + t2[1]) * plane
	return out

# --- public entry point -----------------------------------------------------

## Mesh one section from a pad built by build_pad().
## Returns {opaque: Array, cutout: Array, water: Array} (missing key = empty surface).
static func build_section(pad: Dictionary, section: int, palette: Dictionary) -> Dictionary:
	var ctx := Ctx.new()
	ctx.blocks = pad["blocks"]
	ctx.meta = pad["meta"]
	ctx.light = pad["light"]
	ctx.plane = PAD * PAD
	ctx.full = BlockTable.full_cube
	ctx.opaque = BlockTable.opaque
	ctx.ao_off = ao_offsets()
	var biome: PackedByteArray = pad["biome"]
	var cx: int = pad["cx"]
	var cz: int = pad["cz"]
	var grass_pal: PackedColorArray = palette.get("grass", PackedColorArray([GRASS_FALLBACK]))
	var foliage_pal: PackedColorArray = palette.get("foliage", PackedColorArray([FOLIAGE_FALLBACK]))
	var water_pal: PackedColorArray = palette.get("water", PackedColorArray([WATER_COLOR]))
	var gn := grass_pal.size()
	var fn := foliage_pal.size()
	var wn := water_pal.size()
	var bufs := [Buf.new(), Buf.new(), Buf.new(), Buf.new()]
	var shape: PackedByteArray = BlockTable.shape
	var blocks: PackedByteArray = ctx.blocks
	var y0 := section * 16
	for ly in 16:
		var wy := y0 + ly
		var row := (wy + 1) * ctx.plane
		for lz in 16:
			var zrow := row + (lz + 1) * PAD
			var bidx := (lz + 1) * PAD + 1
			for lx in 16:
				var i := zrow + lx + 1
				var id := blocks[i]
				if id == 0:
					continue
				var sh := shape[id]
				if sh == BlockTable.Shape.NONE:
					continue
				ctx.i = i
				ctx.lx = lx
				ctx.ly = wy
				ctx.lz = lz
				ctx.wx = cx * 16 + lx
				ctx.wy = wy
				ctx.wz = cz * 16 + lz
				ctx.id = id
				ctx.m = ctx.meta[i]
				var bi := biome[bidx + lx]
				ctx.grass = grass_pal[bi % gn]
				ctx.foliage = foliage_pal[bi % fn]
				ctx.water = water_pal[bi % wn]
				_emit_block(bufs, ctx, sh)
	var out := {}
	if not bufs[S_OPAQUE].is_empty():
		out["opaque"] = bufs[S_OPAQUE].to_arrays()
	if not bufs[S_CUTOUT].is_empty():
		out["cutout"] = bufs[S_CUTOUT].to_arrays()
	if not bufs[S_WATER].is_empty():
		out["water"] = bufs[S_WATER].to_arrays()
	if not bufs[S_LAVA].is_empty():
		out["lava"] = bufs[S_LAVA].to_arrays()
	return out

# --- per-block dispatch -----------------------------------------------------

static func _tint_of(ctx: Ctx) -> Color:
	match BlockTable.tint[ctx.id]:
		BlockTable.Tint.GRASS, BlockTable.Tint.MASK:
			return ctx.grass
		BlockTable.Tint.FOLIAGE:
			return ctx.foliage
		BlockTable.Tint.WATER:
			return ctx.water
	return Color.WHITE

static func _emit_block(bufs: Array, ctx: Ctx, sh: int) -> void:
	var id := ctx.id
	var tint := _tint_of(ctx)
	match sh:
		BlockTable.Shape.CUBE, BlockTable.Shape.MODEL:
			_box(bufs[S_OPAQUE], ctx, Vector3.ZERO, Vector3(1, BlockTable.height[id], 1), tint, false)
		BlockTable.Shape.SLAB_BOTTOM:
			_box(bufs[S_OPAQUE], ctx, Vector3.ZERO, Vector3(1, 0.5, 1), tint, false)
		BlockTable.Shape.SNOW_LAYER, BlockTable.Shape.CARPET:
			_box(bufs[S_OPAQUE], ctx, Vector3.ZERO, Vector3(1, maxf(0.0625, BlockTable.height[id]), 1), tint, false)
		BlockTable.Shape.CACTUS:
			_box(bufs[S_OPAQUE], ctx, Vector3(0.0625, 0, 0.0625), Vector3(0.9375, 1, 0.9375), tint, false)
		BlockTable.Shape.CUTOUT_CUBE, BlockTable.Shape.TRANSLUCENT_CUBE:
			_box(bufs[S_CUTOUT], ctx, Vector3.ZERO, Vector3.ONE, tint, true)
		BlockTable.Shape.CROSS:
			_cross(bufs[S_CUTOUT], ctx, tint)
		BlockTable.Shape.CROP:
			_crop(bufs[S_CUTOUT], ctx, tint)
		BlockTable.Shape.LIQUID:
			_liquid(bufs[S_LAVA if BlockTable.lava[id] == 1 else S_WATER], ctx, tint)
		BlockTable.Shape.TORCH:
			_torch(bufs[S_CUTOUT], ctx, tint)
		BlockTable.Shape.LADDER:
			_ladder(bufs[S_CUTOUT], ctx, tint)
		BlockTable.Shape.FENCE:
			_fence(bufs[S_OPAQUE], ctx, tint)
		BlockTable.Shape.DOOR:
			_door(bufs[S_CUTOUT], ctx, tint, false)
		BlockTable.Shape.TRAPDOOR:
			_door(bufs[S_CUTOUT], ctx, tint, true)
		BlockTable.Shape.WATERLILY:
			_waterlily(bufs[S_CUTOUT], ctx, tint)
		_:
			_box(bufs[S_OPAQUE], ctx, Vector3.ZERO, Vector3.ONE, tint, false)

# --- helpers ----------------------------------------------------------------

static func _uv_for(f: int, p: Vector3) -> Vector2:
	match f:
		0: return Vector2(1.0 - p.z, 1.0 - p.y)
		1: return Vector2(p.z, 1.0 - p.y)
		2: return Vector2(p.x, p.z)
		3: return Vector2(p.x, 1.0 - p.z)
		4: return Vector2(p.x, 1.0 - p.y)
	return Vector2(1.0 - p.x, 1.0 - p.y)

## UV2.x encoding read by the chunk shaders (see the shader headers):
##   layer + (frames + sway * 64) / 128
## frames 1..63 = animation strip length, sway = wind flag for plants/leaves.
static func _layer_uv(id: int, face: int, wx: int, wy: int, wz: int) -> float:
	var layer := BlockTable.layer_at(id, face, wx, wy, wz)
	return float(layer) + _frac(id, BlockTable.face_frames[id * 6 + face])

static func _frac(id: int, frames: int) -> float:
	return float(clampi(frames, 1, 63) + (64 if BlockTable.sway[id] == 1 else 0)) / 128.0

## Ambient occlusion + smooth light for one vertex of a face, from the precomputed offset
## table. Returns Vector2(ao, packed_light / 255).
static func _corner(ctx: Ctx, face: int, k: int) -> Vector2:
	var blocks := ctx.blocks
	var lights := ctx.light
	var base := (face * 4 + k) * 4
	var off := ctx.ao_off
	var last := blocks.size() - 1
	var i_n := clampi(ctx.i + off[base], 0, last)
	var i_1 := clampi(ctx.i + off[base + 1], 0, last)
	var i_2 := clampi(ctx.i + off[base + 2], 0, last)
	var i_c := clampi(ctx.i + off[base + 3], 0, last)
	var full := ctx.full
	var opaque := ctx.opaque
	var s1 := full[blocks[i_1]]
	var s2 := full[blocks[i_2]]
	var level := 0 if (s1 == 1 and s2 == 1) else 3 - (s1 + s2 + full[blocks[i_c]])
	var sky := 0
	var blk := 0
	var cnt := 0
	var p := 0
	if opaque[blocks[i_n]] == 0:
		p = lights[i_n]
		sky += p >> 4; blk += p & 15; cnt += 1
	if opaque[blocks[i_1]] == 0:
		p = lights[i_1]
		sky += p >> 4; blk += p & 15; cnt += 1
	if opaque[blocks[i_2]] == 0:
		p = lights[i_2]
		sky += p >> 4; blk += p & 15; cnt += 1
	if opaque[blocks[i_c]] == 0:
		p = lights[i_c]
		sky += p >> 4; blk += p & 15; cnt += 1
	if cnt == 0:
		p = lights[i_n]
		sky = p >> 4
		blk = p & 15
		cnt = 1
	elif cnt > 1:
		sky = (sky * 2 + cnt) / (cnt * 2)      # rounded integer average
		blk = (blk * 2 + cnt) / (cnt * 2)
	var packed := sky * 16 + blk
	return Vector2(AO[level if level >= 0 else 0], float(packed if packed < 256 else 255) / 255.0)

## Flat light sample for plants and other non-cube shapes (own cell or the cell above).
static func _own_light(ctx: Ctx) -> float:
	var p := ctx.light[ctx.i]
	var pa := ctx.light[ctx.i + ctx.plane]
	var sky: int = maxi(p >> 4, pa >> 4)
	var blk: int = maxi(p & 15, pa & 15)
	return float(sky * 16 + blk) / 255.0

# --- shapes -----------------------------------------------------------------

## Axis-aligned box with per-vertex AO and smooth light. Faces flush with the voxel border
## are culled against full cubes (and against the same id when `cull_same`, for leaves/glass).
static func _box(buf: Buf, ctx: Ctx, lo: Vector3, hi: Vector3, tint: Color, cull_same: bool) -> void:
	var id := ctx.id
	var bx := float(ctx.lx)
	var by := float(ctx.ly)
	var bz := float(ctx.lz)
	var sx := hi.x - lo.x
	var sy := hi.y - lo.y
	var sz := hi.z - lo.z
	var full: PackedByteArray = BlockTable.full_cube
	for f in 6:
		var flush := true
		match f:
			0: flush = hi.x >= 1.0
			1: flush = lo.x <= 0.0
			2: flush = hi.y >= 1.0
			3: flush = lo.y <= 0.0
			4: flush = hi.z >= 1.0
			_: flush = lo.z <= 0.0
		if flush:
			var d: Vector3i = BlockShapes.FACE_DIR[f]
			var nid := ctx.at(d.x, d.y, d.z)
			if full[nid] == 1:
				continue
			if cull_same and nid == id:
				continue
		var corners: Array = BlockShapes.FACE_CORNERS[f]
		var c0: Vector3 = corners[0]
		var c1: Vector3 = corners[1]
		var c2: Vector3 = corners[2]
		var c3: Vector3 = corners[3]
		var q0 := Vector3(lo.x + c0.x * sx, lo.y + c0.y * sy, lo.z + c0.z * sz)
		var q1 := Vector3(lo.x + c1.x * sx, lo.y + c1.y * sy, lo.z + c1.z * sz)
		var q2 := Vector3(lo.x + c2.x * sx, lo.y + c2.y * sy, lo.z + c2.z * sz)
		var q3 := Vector3(lo.x + c3.x * sx, lo.y + c3.y * sy, lo.z + c3.z * sz)
		var a0 := _corner(ctx, f, 0)
		var a1 := _corner(ctx, f, 1)
		var a2 := _corner(ctx, f, 2)
		var a3 := _corner(ctx, f, 3)
		buf.quad(
			Vector3(bx + q0.x, by + q0.y, bz + q0.z), Vector3(bx + q1.x, by + q1.y, bz + q1.z),
			Vector3(bx + q2.x, by + q2.y, bz + q2.z), Vector3(bx + q3.x, by + q3.y, bz + q3.z),
			BlockShapes.FACE_NORMAL[f],
			_uv_for(f, q0), _uv_for(f, q1), _uv_for(f, q2), _uv_for(f, q3),
			_layer_uv(id, f, ctx.wx, ctx.wy, ctx.wz),
			a0.y, a1.y, a2.y, a3.y, a0.x, a1.x, a2.x, a3.x, tint)

## One flat quad with flat lighting, optionally double sided.
static func _plane(buf: Buf, p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, nrm: Vector3,
		layer: float, light: float, tint: Color, two_sided := true,
		uv0 := Vector2(0, 0), uv1 := Vector2(1, 0), uv2 := Vector2(1, 1), uv3 := Vector2(0, 1)) -> void:
	buf.quad(p0, p1, p2, p3, nrm, uv0, uv1, uv2, uv3, layer, light, light, light, light, 1.0, 1.0, 1.0, 1.0, tint)
	if two_sided:
		buf.quad(p3, p2, p1, p0, -nrm, uv3, uv2, uv1, uv0, layer, light, light, light, light, 1.0, 1.0, 1.0, 1.0, tint)

static func _cross(buf: Buf, ctx: Ctx, tint: Color) -> void:
	var id := ctx.id
	var o := BlockShapes.plant_offset(ctx.wx, ctx.wz)
	var bx := float(ctx.lx) + 0.5 + o.x
	var bz := float(ctx.lz) + 0.5 + o.z
	var by := float(ctx.ly)
	var light := _own_light(ctx)
	var r := 0.5
	var layer := _layer_uv(id, 0, ctx.wx, ctx.wy, ctx.wz)
	_cross_pair(buf, bx, by, bz, r, layer, light, tint)
	if BlockTable.double_plant[id] == 1 and ctx.at(0, 1, 0) == 0:
		var top := float(BlockTable.face_layer[id * 6 + 2]) + _frac(id, BlockTable.face_frames[id * 6 + 2])
		_cross_pair(buf, bx, by + 1.0, bz, r, top, light, tint)

static func _cross_pair(buf: Buf, bx: float, by: float, bz: float, r: float, layer: float, light: float, tint: Color) -> void:
	_plane(buf, Vector3(bx - r, by + 1, bz - r), Vector3(bx + r, by + 1, bz + r), Vector3(bx + r, by, bz + r), Vector3(bx - r, by, bz - r),
		Vector3(-0.7071, 0, 0.7071), layer, light, tint)
	_plane(buf, Vector3(bx - r, by + 1, bz + r), Vector3(bx + r, by + 1, bz - r), Vector3(bx + r, by, bz - r), Vector3(bx - r, by, bz + r),
		Vector3(0.7071, 0, 0.7071), layer, light, tint)

static func _crop(buf: Buf, ctx: Ctx, tint: Color) -> void:
	var id := ctx.id
	var layer := _layer_uv(id, 0, ctx.wx, ctx.wy, ctx.wz)
	var stages: PackedInt32Array = BlockTable.stage_layers[id]
	if stages.size() > 0:
		var st: int = clampi(ctx.m & 7, 0, stages.size() - 1)
		layer = float(stages[st]) + _frac(id, 1)
	var bx := float(ctx.lx)
	var by := float(ctx.ly)
	var bz := float(ctx.lz)
	var light := _own_light(ctx)
	for k in 2:
		var o := 0.25 + 0.5 * float(k)
		_plane(buf, Vector3(bx, by + 1, bz + o), Vector3(bx + 1, by + 1, bz + o), Vector3(bx + 1, by, bz + o), Vector3(bx, by, bz + o),
			Vector3(0, 0, 1), layer, light, tint)
		_plane(buf, Vector3(bx + o, by + 1, bz + 1), Vector3(bx + o, by + 1, bz), Vector3(bx + o, by, bz), Vector3(bx + o, by, bz + 1),
			Vector3(1, 0, 0), layer, light, tint)

static func _waterlily(buf: Buf, ctx: Ctx, tint: Color) -> void:
	var bx := float(ctx.lx)
	var by := float(ctx.ly) + 0.015625
	var bz := float(ctx.lz)
	var layer := _layer_uv(ctx.id, 2, ctx.wx, ctx.wy, ctx.wz)
	_plane(buf, Vector3(bx, by, bz), Vector3(bx + 1, by, bz), Vector3(bx + 1, by, bz + 1), Vector3(bx, by, bz + 1),
		Vector3(0, 1, 0), layer, _own_light(ctx), tint)

static func _torch(buf: Buf, ctx: Ctx, tint: Color) -> void:
	var bx := float(ctx.lx)
	var by := float(ctx.ly)
	var bz := float(ctx.lz)
	var light := _own_light(ctx)
	var layer := _layer_uv(ctx.id, 0, ctx.wx, ctx.wy, ctx.wz)
	var a := 0.4375
	var b := 0.5625
	var top := 0.625
	var u0 := 0.4375
	var u1 := 0.5625
	var v0 := 0.375
	_plane(buf, Vector3(bx + a, by + top, bz + a), Vector3(bx + b, by + top, bz + a), Vector3(bx + b, by, bz + a), Vector3(bx + a, by, bz + a),
		Vector3(0, 0, -1), layer, light, tint, false, Vector2(u0, v0), Vector2(u1, v0), Vector2(u1, 1.0), Vector2(u0, 1.0))
	_plane(buf, Vector3(bx + b, by + top, bz + b), Vector3(bx + a, by + top, bz + b), Vector3(bx + a, by, bz + b), Vector3(bx + b, by, bz + b),
		Vector3(0, 0, 1), layer, light, tint, false, Vector2(u0, v0), Vector2(u1, v0), Vector2(u1, 1.0), Vector2(u0, 1.0))
	_plane(buf, Vector3(bx + a, by + top, bz + b), Vector3(bx + a, by + top, bz + a), Vector3(bx + a, by, bz + a), Vector3(bx + a, by, bz + b),
		Vector3(-1, 0, 0), layer, light, tint, false, Vector2(u0, v0), Vector2(u1, v0), Vector2(u1, 1.0), Vector2(u0, 1.0))
	_plane(buf, Vector3(bx + b, by + top, bz + a), Vector3(bx + b, by + top, bz + b), Vector3(bx + b, by, bz + b), Vector3(bx + b, by, bz + a),
		Vector3(1, 0, 0), layer, light, tint, false, Vector2(u0, v0), Vector2(u1, v0), Vector2(u1, 1.0), Vector2(u0, 1.0))
	_plane(buf, Vector3(bx + a, by + top, bz + a), Vector3(bx + b, by + top, bz + a), Vector3(bx + b, by + top, bz + b), Vector3(bx + a, by + top, bz + b),
		Vector3(0, 1, 0), layer, light, tint, false, Vector2(u0, v0), Vector2(u1, v0), Vector2(u1, 0.5625), Vector2(u0, 0.5625))

static func _ladder(buf: Buf, ctx: Ctx, tint: Color) -> void:
	var facing := ctx.m & BlockShapes.META_FACING
	var bx := float(ctx.lx)
	var by := float(ctx.ly)
	var bz := float(ctx.lz)
	var light := _own_light(ctx)
	var layer := _layer_uv(ctx.id, 0, ctx.wx, ctx.wy, ctx.wz)
	var e := 0.0625
	match facing:
		0:
			_plane(buf, Vector3(bx, by + 1, bz + 1 - e), Vector3(bx + 1, by + 1, bz + 1 - e), Vector3(bx + 1, by, bz + 1 - e), Vector3(bx, by, bz + 1 - e), Vector3(0, 0, 1), layer, light, tint)
		1:
			_plane(buf, Vector3(bx + e, by + 1, bz), Vector3(bx + e, by + 1, bz + 1), Vector3(bx + e, by, bz + 1), Vector3(bx + e, by, bz), Vector3(-1, 0, 0), layer, light, tint)
		2:
			_plane(buf, Vector3(bx + 1, by + 1, bz + e), Vector3(bx, by + 1, bz + e), Vector3(bx, by, bz + e), Vector3(bx + 1, by, bz + e), Vector3(0, 0, -1), layer, light, tint)
		_:
			_plane(buf, Vector3(bx + 1 - e, by + 1, bz + 1), Vector3(bx + 1 - e, by + 1, bz), Vector3(bx + 1 - e, by, bz), Vector3(bx + 1 - e, by, bz + 1), Vector3(1, 0, 0), layer, light, tint)

static func _fence(buf: Buf, ctx: Ctx, tint: Color) -> void:
	_box(buf, ctx, Vector3(0.375, 0, 0.375), Vector3(0.625, 1, 0.625), tint, false)
	for f in 4:
		var face: int = [0, 1, 4, 5][f]
		var d: Vector3i = BlockShapes.FACE_DIR[face]
		var nid := ctx.at(d.x, d.y, d.z)
		if nid == 0:
			continue
		if BlockTable.full_cube[nid] == 0 and BlockTable.shape[nid] != BlockTable.Shape.FENCE:
			continue
		for bar in 2:
			var y0 := 0.375 + 0.375 * float(bar)
			var y1 := y0 + 0.1875
			var lo := Vector3.ZERO
			var hi := Vector3.ZERO
			match face:
				0: lo = Vector3(0.625, y0, 0.4375); hi = Vector3(1.0, y1, 0.5625)
				1: lo = Vector3(0.0, y0, 0.4375); hi = Vector3(0.375, y1, 0.5625)
				4: lo = Vector3(0.4375, y0, 0.625); hi = Vector3(0.5625, y1, 1.0)
				_: lo = Vector3(0.4375, y0, 0.0); hi = Vector3(0.5625, y1, 0.375)
			_box(buf, ctx, lo, hi, tint, false)

static func _door(buf: Buf, ctx: Ctx, tint: Color, trapdoor: bool) -> void:
	var open := (ctx.m & BlockShapes.META_OPEN) != 0
	var facing := ctx.m & BlockShapes.META_FACING
	var t := 0.1875
	var lo := Vector3.ZERO
	var hi := Vector3.ONE
	if trapdoor and not open:
		hi = Vector3(1, t, 1)
	else:
		if open and not trapdoor:
			facing = (facing + 1) & 3
		match facing:
			0: lo = Vector3(0, 0, 1.0 - t); hi = Vector3(1, 1, 1)
			1: lo = Vector3.ZERO; hi = Vector3(t, 1, 1)
			2: lo = Vector3.ZERO; hi = Vector3(1, 1, t)
			_: lo = Vector3(1.0 - t, 0, 0); hi = Vector3(1, 1, 1)
	_box(buf, ctx, lo, hi, tint, false)

static func _liquid(buf: Buf, ctx: Ctx, tint: Color) -> void:
	var id := ctx.id
	var lx := float(ctx.lx)
	var ly := float(ctx.ly)
	var lz := float(ctx.lz)
	var liquid: PackedByteArray = BlockTable.liquid
	var full: PackedByteArray = BlockTable.full_cube
	var covered := liquid[ctx.at(0, 1, 0)] == 1
	var hs := PackedFloat32Array([0.875, 0.875, 0.875, 0.875])   # corners (0,0) (1,0) (1,1) (0,1)
	if not covered:
		var offs := [Vector2i(-1, -1), Vector2i(0, -1), Vector2i(0, 0), Vector2i(-1, 0)]
		for k in 4:
			var o: Vector2i = offs[k]
			var sum := 0.0
			var cnt := 0
			var top := false
			for dz in 2:
				for dx in 2:
					var px := o.x + dx
					var pz := o.y + dz
					var nid := ctx.at(px, 0, pz)
					if liquid[nid] == 1:
						var lvl := ctx.meta_at(px, 0, pz) & BlockShapes.META_LEVEL
						if lvl == 0:
							lvl = 8
						sum += BlockShapes.liquid_height(lvl)
						cnt += 1
					if liquid[ctx.at(px, 1, pz)] == 1:
						top = true
			if top:
				hs[k] = 1.0
			elif cnt > 0:
				hs[k] = sum / float(cnt)
	else:
		hs = PackedFloat32Array([1.0, 1.0, 1.0, 1.0])
	var light := _own_light(ctx)
	var still := _layer_uv(id, 2, ctx.wx, ctx.wy, ctx.wz)
	var flow := float(BlockTable.flow_layer[id]) + _frac(id, BlockTable.flow_frames[id])
	if not covered:
		var p0 := Vector3(lx, ly + hs[0], lz)
		var p1 := Vector3(lx + 1, ly + hs[1], lz)
		var p2 := Vector3(lx + 1, ly + hs[2], lz + 1)
		var p3 := Vector3(lx, ly + hs[3], lz + 1)
		buf.quad(p0, p1, p2, p3, Vector3(0, 1, 0), Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 1),
			still, light, light, light, light, 1.0, 1.0, 1.0, 1.0, tint)
		buf.quad(p3, p2, p1, p0, Vector3(0, -1, 0), Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0),
			still, light, light, light, light, 1.0, 1.0, 1.0, 1.0, tint)
	for f in 4:
		var face: int = [0, 1, 4, 5][f]
		var d: Vector3i = BlockShapes.FACE_DIR[face]
		var nid := ctx.at(d.x, d.y, d.z)
		if liquid[nid] == 1 or full[nid] == 1:
			continue
		var ta := 0.0
		var tb := 0.0
		var pa := Vector3.ZERO
		var pb := Vector3.ZERO
		match face:
			0:
				ta = hs[1]; tb = hs[2]; pa = Vector3(lx + 1, ly, lz); pb = Vector3(lx + 1, ly, lz + 1)
			1:
				ta = hs[3]; tb = hs[0]; pa = Vector3(lx, ly, lz + 1); pb = Vector3(lx, ly, lz)
			4:
				ta = hs[2]; tb = hs[3]; pa = Vector3(lx + 1, ly, lz + 1); pb = Vector3(lx, ly, lz + 1)
			_:
				ta = hs[0]; tb = hs[1]; pa = Vector3(lx, ly, lz); pb = Vector3(lx + 1, ly, lz)
		buf.quad(pa + Vector3(0, ta, 0), pb + Vector3(0, tb, 0), pb, pa, BlockShapes.FACE_NORMAL[face],
			Vector2(0, 1.0 - ta), Vector2(1, 1.0 - tb), Vector2(1, 1), Vector2(0, 1),
			flow, light, light, light, light, 1.0, 1.0, 1.0, 1.0, tint)
	var below := ctx.at(0, -1, 0)
	if liquid[below] == 0 and full[below] == 0:
		buf.quad(Vector3(lx, ly, lz + 1), Vector3(lx + 1, ly, lz + 1), Vector3(lx + 1, ly, lz), Vector3(lx, ly, lz),
			Vector3(0, -1, 0), Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 1),
			still, light, light, light, light, 1.0, 1.0, 1.0, 1.0, tint)
