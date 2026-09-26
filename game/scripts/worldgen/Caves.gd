class_name Caves
extends RefCounted
## Cheap 3D cave noise: two ridged "spaghetti" tunnel noises plus a "cheese" blob noise,
## sampled on a stride-4 lattice and trilinearly interpolated (docs/briefs/worldgen.md §1).
##
## `carve_list()` returns the column-local indices the generator should turn into air (or
## lava near the bedrock). Sampling on a lattice keeps the noise cost at ~1.6k samples per
## column, and a per-cell min/max rejection test skips the 4x4x4 blocks that cannot contain
## a cave at all, which is most of them.
##
## Read-only after configure(): safe on several worker threads.

const HEIGHT := WorldConst.HEIGHT
const STRIDE := 4

var enabled := false
var seed: int = 0
## Cheese caves: carve where the field is above this.
var cheese_threshold := 0.40
## Spaghetti caves: carve where max(|n1|, |n2|) is below this.
var tunnel_threshold := 0.055
## Vertical squash (>1 = flatter, more horizontal caves).
var cheese_squash := 1.7
var tunnel_squash := 2.3
## Highest y that may be carved is (column top - surface_margin).
var surface_margin := 4
## Highest y the carver touches.
var ceiling := 96

var _cheese := FastNoiseLite.new()
var _tun_a := FastNoiseLite.new()
var _tun_b := FastNoiseLite.new()

func configure(p_seed: int, p_enabled: bool) -> void:
	seed = p_seed
	enabled = p_enabled
	_cheese.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_cheese.seed = p_seed + 0xC0FE
	_cheese.frequency = 0.016
	_cheese.fractal_type = FastNoiseLite.FRACTAL_FBM
	_cheese.fractal_octaves = 2
	_tun_a.noise_type = FastNoiseLite.TYPE_SIMPLEX
	_tun_a.seed = p_seed + 0xBEEF
	_tun_a.frequency = 0.021
	_tun_a.fractal_type = FastNoiseLite.FRACTAL_FBM
	_tun_a.fractal_octaves = 2
	_tun_b.noise_type = FastNoiseLite.TYPE_SIMPLEX
	_tun_b.seed = p_seed + 0x1D0D
	_tun_b.frequency = 0.021
	_tun_b.fractal_type = FastNoiseLite.FRACTAL_FBM
	_tun_b.fractal_octaves = 2

## Column-local indices (x + 16 * (z + 16 * y)) to carve out.
func carve_list(cx: int, cz: int, tops: PackedInt32Array) -> PackedInt32Array:
	var out := PackedInt32Array()
	if not enabled:
		return out
	var ox := cx * 16
	var oz := cz * 16
	var max_top := 0
	for i in 256:
		if tops[i] > max_top:
			max_top = tops[i]
	# Nothing above `ceiling` is carved: mountain cores are never seen and the lattice cost
	# grows with height.
	var y_top: int = clampi(mini(max_top - surface_margin, ceiling), 0, HEIGHT - 1)
	if y_top < 4:
		return out
	var levels: int = (y_top >> 2) + 1              # sample planes at y = 0, 4, ... levels*4
	var plane := 25                                  # 5 x 5 lattice per plane
	var gc := PackedFloat32Array()
	var gt := PackedFloat32Array()
	gc.resize(plane * (levels + 1))
	gt.resize(plane * (levels + 1))
	for sy in levels + 1:
		var wy := float(sy * STRIDE)
		var cy := wy * cheese_squash
		var ty := wy * tunnel_squash
		var base := sy * plane
		for sz in 5:
			var wz := float(oz + sz * STRIDE)
			for sx in 5:
				var wx := float(ox + sx * STRIDE)
				var i := base + sz * 5 + sx
				gc[i] = _cheese.get_noise_3d(wx, cy, wz)
				var a: float = absf(_tun_a.get_noise_3d(wx, ty, wz))
				var b: float = absf(_tun_b.get_noise_3d(wx, ty, wz))
				gt[i] = maxf(a, b)
	for cell_y in levels:
		var y0 := cell_y * STRIDE
		for cell_z in 4:
			for cell_x in 4:
				_carve_cell(out, gc, gt, cell_x, cell_z, cell_y, y0, tops, plane)
	return out

## One 4x4x4 block: reject on the corner bounds, otherwise nested-lerp the 64 voxels.
func _carve_cell(out: PackedInt32Array, gc: PackedFloat32Array, gt: PackedFloat32Array,
		cell_x: int, cell_z: int, cell_y: int, y0: int, tops: PackedInt32Array, plane: int) -> void:
	var b0 := cell_y * plane + cell_z * 5 + cell_x
	var b1 := b0 + plane
	var c000 := gc[b0]
	var c100 := gc[b0 + 1]
	var c010 := gc[b0 + 5]
	var c110 := gc[b0 + 6]
	var c001 := gc[b1]
	var c101 := gc[b1 + 1]
	var c011 := gc[b1 + 5]
	var c111 := gc[b1 + 6]
	var cmax: float = maxf(maxf(maxf(c000, c100), maxf(c010, c110)), maxf(maxf(c001, c101), maxf(c011, c111)))
	var t000 := gt[b0]
	var t100 := gt[b0 + 1]
	var t010 := gt[b0 + 5]
	var t110 := gt[b0 + 6]
	var t001 := gt[b1]
	var t101 := gt[b1 + 1]
	var t011 := gt[b1 + 5]
	var t111 := gt[b1 + 6]
	var tmin: float = minf(minf(minf(t000, t100), minf(t010, t110)), minf(minf(t001, t101), minf(t011, t111)))
	if cmax <= cheese_threshold and tmin >= tunnel_threshold:
		return                                       # no cave can be inside this block
	var lx0 := cell_x * STRIDE
	var lz0 := cell_z * STRIDE
	for dy in STRIDE:
		var y := y0 + dy
		if y < 1 or y >= HEIGHT:
			continue
		var fy := float(dy) * 0.25
		# y edges
		var ce00: float = lerpf(c000, c001, fy)
		var ce10: float = lerpf(c100, c101, fy)
		var ce01: float = lerpf(c010, c011, fy)
		var ce11: float = lerpf(c110, c111, fy)
		var te00: float = lerpf(t000, t001, fy)
		var te10: float = lerpf(t100, t101, fy)
		var te01: float = lerpf(t010, t011, fy)
		var te11: float = lerpf(t110, t111, fy)
		var row := 256 * y
		for dz in STRIDE:
			var fz := float(dz) * 0.25
			var c0: float = lerpf(ce00, ce01, fz)
			var c1: float = lerpf(ce10, ce11, fz)
			var t0: float = lerpf(te00, te01, fz)
			var t1: float = lerpf(te10, te11, fz)
			var lz := lz0 + dz
			var base_xz := 16 * lz
			for dx in STRIDE:
				var lx := lx0 + dx
				var top := tops[lx + base_xz]
				if y > top - surface_margin:
					continue
				var fx := float(dx) * 0.25
				var cv: float = c0 + (c1 - c0) * fx
				if cv > cheese_threshold:
					out.append(lx + base_xz + row)
					continue
				var tv: float = t0 + (t1 - t0) * fx
				if tv < tunnel_threshold:
					out.append(lx + base_xz + row)
