class_name BlockTable
## Flat per-block-id lookup arrays built once from Registry/Textures so the mesher, lighting and
## physics never touch Dictionaries in hot loops. All arrays are read-only after build() and are
## safe to read from WorkerThreadPool tasks (copy the static var into a local first).

enum Shape { NONE, CUBE, CUTOUT_CUBE, TRANSLUCENT_CUBE, CROSS, CROP, LIQUID, SLAB_BOTTOM, TORCH, LADDER,
	FENCE, DOOR, TRAPDOOR, WATERLILY, SNOW_LAYER, CARPET, MODEL, CACTUS }
enum Tint { NONE, GRASS, FOLIAGE, WATER, MASK }

const SHAPE_NAMES := {
	"none": Shape.NONE, "cube": Shape.CUBE, "cutout_cube": Shape.CUTOUT_CUBE, "translucent_cube": Shape.TRANSLUCENT_CUBE,
	"cross": Shape.CROSS, "crop": Shape.CROP, "liquid": Shape.LIQUID, "slab_bottom": Shape.SLAB_BOTTOM, "torch": Shape.TORCH,
	"ladder": Shape.LADDER, "fence": Shape.FENCE, "door": Shape.DOOR, "trapdoor": Shape.TRAPDOOR, "waterlily": Shape.WATERLILY,
	"snow_layer": Shape.SNOW_LAYER, "carpet": Shape.CARPET, "model": Shape.MODEL, "cactus": Shape.CACTUS,
}
const TINT_NAMES := {"none": Tint.NONE, "grass": Tint.GRASS, "foliage": Tint.FOLIAGE, "water": Tint.WATER, "mask": Tint.MASK}
const FACE_KEYS := ["east", "west", "top", "bottom", "south", "north"]

static var built := false
static var count := 0
static var shape := PackedByteArray()
static var opaque := PackedByteArray()        # blocks light and hides neighbouring cube faces
static var full_cube := PackedByteArray()     # opaque cube of height 1 (face culling)
static var solid := PackedByteArray()         # collides
static var transparent := PackedByteArray()
static var replaceable := PackedByteArray()
static var liquid := PackedByteArray()
static var lava := PackedByteArray()
static var climbable := PackedByteArray()
static var double_plant := PackedByteArray()
static var gravity := PackedByteArray()
static var light := PackedByteArray()         # emission 0..15
static var atten := PackedByteArray()         # extra sky-light attenuation (water = 2)
static var tint := PackedByteArray()          # Tint enum
static var flow_spread := PackedByteArray()
static var flow_tick := PackedByteArray()
static var height := PackedFloat32Array()     # collision/visual height for cube-like shapes
static var hardness := PackedFloat32Array()
static var fps := PackedFloat32Array()        # animated tiles fps (0 = static)
static var face_layer := PackedInt32Array()   # id * 6 + face -> texture array layer
static var face_frames := PackedInt32Array()  # id * 6 + face -> animation frames
static var variant_all := PackedByteArray()   # 1 -> variants replace every face, else only the top
static var variant_layers: Array = []         # id -> PackedInt32Array
static var stage_layers: Array = []           # id -> PackedInt32Array (crop growth stages)
static var flow_layer := PackedInt32Array()   # liquids: layer of the flowing texture
static var flow_frames := PackedInt32Array()
static var sway := PackedByteArray()          # 0 none, 1 plant (bends at the tip), 2 leaves (whole block)
static var names := PackedStringArray()
static var emissive_ids := PackedInt32Array()
static var water_id := -1
static var lava_id := -1

static func build() -> void:
	if built:
		return
	if not Registry.loaded:
		Registry.load_all()
	if not Textures.built:
		Textures.build_block_array()
	count = Registry.blocks.size()
	shape.resize(count); opaque.resize(count); full_cube.resize(count); solid.resize(count)
	transparent.resize(count); replaceable.resize(count); liquid.resize(count); lava.resize(count)
	climbable.resize(count); double_plant.resize(count); gravity.resize(count); light.resize(count)
	atten.resize(count); tint.resize(count); flow_spread.resize(count); flow_tick.resize(count)
	height.resize(count); hardness.resize(count); fps.resize(count)
	face_layer.resize(count * 6); face_frames.resize(count * 6); sway.resize(count)
	variant_all.resize(count); flow_layer.resize(count); flow_frames.resize(count)
	variant_layers.clear(); stage_layers.clear(); names.clear(); emissive_ids.clear()
	for id in count:
		var b: Dictionary = Registry.blocks[id]
		var sh: int = SHAPE_NAMES.get(String(b.get("shape", "cube")), Shape.CUBE)
		shape[id] = sh
		names.append(String(b.get("id", "?")))
		var is_opaque: bool = bool(b.get("opaque", true))
		if sh == Shape.CACTUS:
			is_opaque = false
		opaque[id] = 1 if is_opaque else 0
		solid[id] = 1 if bool(b.get("solid", true)) else 0
		transparent[id] = 0 if is_opaque else 1
		replaceable[id] = 1 if bool(b.get("replaceable", false)) else 0
		liquid[id] = 1 if sh == Shape.LIQUID else 0
		var flow: Dictionary = b.get("flow", {})
		lava[id] = 1 if bool(flow.get("lava", false)) else 0
		flow_spread[id] = int(flow.get("spread", 7))
		flow_tick[id] = int(flow.get("tick", 5))
		climbable[id] = 1 if (bool(b.get("climbable", false)) or sh == Shape.LADDER) else 0
		double_plant[id] = 1 if bool(b.get("double", false)) else 0
		gravity[id] = 1 if bool(b.get("gravity", false)) else 0
		light[id] = clampi(int(b.get("light", 0)), 0, 15)
		if light[id] > 0:
			emissive_ids.append(id)
		atten[id] = clampi(int(b.get("light_attenuation", 0)), 0, 15)
		if atten[id] == 0 and sh == Shape.CUTOUT_CUBE:
			atten[id] = 1                 # leaves/glass panes dim the sunlight like in Minecraft
		var material := String(b.get("material", "stone"))
		# Wind mode for the cutout shader: plants bend from their base, leaf blocks drift as a
		# whole so neighbouring leaf cubes stay welded together.
		if material == "leaves":
			sway[id] = 2
		elif sh == Shape.CROSS or sh == Shape.CROP:
			sway[id] = 1
		else:
			sway[id] = 0
		tint[id] = TINT_NAMES.get(String(b.get("tint", "none")), Tint.NONE)
		var h := float(b.get("height", 1.0))
		if sh == Shape.SLAB_BOTTOM:
			h = 0.5
		elif sh == Shape.SNOW_LAYER:
			h = float(b.get("height", 0.125))
		elif sh == Shape.CARPET:
			h = 0.0625
		height[id] = h
		full_cube[id] = 1 if (is_opaque and sh == Shape.CUBE and h >= 1.0) else 0
		hardness[id] = float(b.get("hardness", 1.0))
		var anim: Dictionary = b.get("animated", {})
		fps[id] = float(anim.get("fps", 0.0)) if not anim.is_empty() else 0.0
		# Per-face texture keys (same resolution rules as Textures.build_block_array).
		var t: Dictionary = b.get("textures", {})
		var all_key: String = t.get("all", "")
		var side_key: String = t.get("side", all_key)
		for f in 6:
			var k: String = t.get(FACE_KEYS[f], "")
			if k == "":
				if f == 2:
					k = t.get("top", all_key)
				elif f == 3:
					k = t.get("bottom", all_key)
				else:
					k = side_key
			var layer := Textures.layer(k)
			var tex_layer := Textures.block_face_layer(id, f)
			if b.get("variants", []).is_empty() and tex_layer != layer:
				layer = tex_layer
			face_layer[id * 6 + f] = layer
			face_frames[id * 6 + f] = maxi(1, Textures.frames(k))
		# Never leave a face on the magenta "missing" layer when another face has a texture
		# (door/trapdoor style defs only declare top/bottom).
		var fallback_face := -1
		for f in 6:
			if face_layer[id * 6 + f] != 0:
				fallback_face = f
				break
		if fallback_face >= 0:
			for f in 6:
				if face_layer[id * 6 + f] == 0:
					face_layer[id * 6 + f] = face_layer[id * 6 + fallback_face]
					face_frames[id * 6 + f] = face_frames[id * 6 + fallback_face]
		var vars := PackedInt32Array()
		for v in b.get("variants", []):
			vars.append(Textures.layer(String(v)))
		variant_layers.append(vars)
		variant_all[id] = 1 if t.has("all") else 0
		var stages := PackedInt32Array()
		for s in b.get("plant", {}).get("stage_textures", []):
			stages.append(Textures.layer(String(s)))
		stage_layers.append(stages)
		var fk: String = b.get("flow_texture", "")
		flow_layer[id] = Textures.layer(fk) if fk != "" else face_layer[id * 6]
		flow_frames[id] = maxi(1, Textures.frames(fk)) if fk != "" else face_frames[id * 6]
	_borrow_missing_tiles()
	water_id = Registry.block_id("water")
	lava_id = Registry.block_id("lava")
	built = true

## Blocks whose tile the asset pipeline has not produced yet would render as the magenta
## "missing texture" layer. Borrow a tile from the closest relative instead (same name suffix,
## e.g. redwood_log -> oak_log, else the first block with the same shape) and warn once, so a
## data gap looks slightly wrong instead of screaming pink.
static func _borrow_missing_tiles() -> void:
	var missing := PackedInt32Array()
	for id in range(1, count):
		if shape[id] == Shape.NONE:
			continue
		var any := false
		for f in 6:
			if face_layer[id * 6 + f] != 0:
				any = true
				break
		if not any:
			missing.append(id)
	if missing.is_empty():
		return
	var borrowed := PackedStringArray()
	for id in missing:
		var nm := names[id]
		var parts := nm.split("_", false)
		var suffix: String = parts[parts.size() - 1] if parts.size() > 1 else nm
		var donor := -1
		var preferred := Registry.block_id("oak_" + suffix)
		if preferred > 0 and face_layer[preferred * 6] != 0:
			donor = preferred
		if donor < 0:
			for j in range(1, count):
				if j == id or face_layer[j * 6] == 0:
					continue
				if names[j].ends_with("_" + suffix):
					donor = j
					break
		if donor < 0:
			for j in range(1, count):
				if j != id and shape[j] == shape[id] and face_layer[j * 6] != 0:
					donor = j
					break
		if donor < 0:
			continue
		for f in 6:
			face_layer[id * 6 + f] = face_layer[donor * 6 + f]
			face_frames[id * 6 + f] = face_frames[donor * 6 + f]
		variant_layers[id] = variant_layers[donor]
		variant_all[id] = variant_all[donor]
		borrowed.append("%s<-%s" % [nm, names[donor]])
	if borrowed.size() > 0:
		Log.w("BlockTable: %d blocks have no tile in assets/textures/blocks, borrowed: %s" % [
			borrowed.size(), ", ".join(borrowed)])

## Same position hash as Textures.block_face_layer so meshes and item icons agree.
static func layer_at(id: int, face: int, x: int, y: int, z: int) -> int:
	var vars: PackedInt32Array = variant_layers[id]
	if vars.size() > 0 and (face == 2 or variant_all[id] == 1):
		var h := (x * 73856093) ^ (y * 19349663) ^ (z * 83492791)
		h = (h ^ (h >> 13)) & 0x7fffffff
		return vars[h % vars.size()]
	return face_layer[id * 6 + face]

static func is_liquid(id: int) -> bool:
	return id >= 0 and id < count and liquid[id] == 1

static func is_opaque(id: int) -> bool:
	return id >= 0 and id < count and opaque[id] == 1

static func is_solid(id: int) -> bool:
	return id >= 0 and id < count and solid[id] == 1

static func name_of(id: int) -> String:
	return names[id] if id >= 0 and id < count else "?"

static func id_of(name: String) -> int:
	return Registry.block_id(name)
