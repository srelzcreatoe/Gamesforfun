class_name SaveManager
extends RefCounted
## Per-column chunk persistence.
##
## Layout: user://worlds/<slug>/<planet>/c_<cx>_<cz>.bin
##   magic  "DBSC" (4 bytes)
##   u16    version
##   i32    cx, i32 cz
##   u32    uncompressed size
##   u32    compressed size
##   bytes  DEFLATE of blocks (32768) + meta (32768) + biomes (256)
##   u32    length of the trailing JSON blob (version >= 2; 0 when there is none)
##   bytes  UTF-8 JSON of ChunkColumn.extra (container contents, sign text, ...)
## Light is not stored; it is recomputed on load (cheap and keeps saves small).
## Only columns with `modified == true` are written; everything else regenerates from the seed.

const MAGIC := "DBSC"
const VERSION := 2

var slug := ""
var planet := ""
var dir := ""
var enabled := true
var saved_count := 0
var failed_count := 0

func setup(p_slug: String, p_planet: String) -> void:
	slug = p_slug
	planet = p_planet
	dir = "user://worlds/%s/%s" % [slug, planet]
	enabled = slug != ""
	if enabled and not DirAccess.dir_exists_absolute(dir):
		DirAccess.make_dir_recursive_absolute(dir)

func column_path(cx: int, cz: int) -> String:
	return "%s/c_%d_%d.bin" % [dir, cx, cz]

func has_column(cx: int, cz: int) -> bool:
	return enabled and FileAccess.file_exists(column_path(cx, cz))

func save_column(col: ChunkColumn) -> bool:
	if not enabled:
		return false
	var f := FileAccess.open(column_path(col.cx, col.cz), FileAccess.WRITE)
	if f == null:
		Log.w("SaveManager: cannot write " + column_path(col.cx, col.cz))
		failed_count += 1
		return false
	var raw := col.pack()
	var comp := raw.compress(FileAccess.COMPRESSION_DEFLATE)
	f.store_buffer(MAGIC.to_ascii_buffer())
	f.store_16(VERSION)
	f.store_32(col.cx)
	f.store_32(col.cz)
	f.store_32(raw.size())
	f.store_32(comp.size())
	f.store_buffer(comp)
	var extra_bytes := PackedByteArray()
	if not col.extra.is_empty():
		extra_bytes = JSON.stringify(col.extra).to_utf8_buffer()
	f.store_32(extra_bytes.size())
	if extra_bytes.size() > 0:
		f.store_buffer(extra_bytes)
	f.close()
	col.modified = false
	saved_count += 1
	return true

## Returns true when the column was restored (blocks/meta/biomes filled, light still empty).
func load_column(col: ChunkColumn) -> bool:
	if not enabled:
		return false
	var path := column_path(col.cx, col.cz)
	if not FileAccess.file_exists(path):
		return false
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return false
	var ok := false
	if f.get_length() >= 22:
		var magic := f.get_buffer(4).get_string_from_ascii()
		var ver := f.get_16()
		var cx := f.get_32()
		var cz := f.get_32()
		var raw_size := f.get_32()
		var comp_size := f.get_32()
		if magic == MAGIC and ver <= VERSION and raw_size == WorldConst.COLUMN_VOLUME * 2 + 256 \
				and comp_size > 0 and comp_size <= f.get_length():
			var comp := f.get_buffer(comp_size)
			if comp.size() == comp_size:
				var raw := comp.decompress(raw_size, FileAccess.COMPRESSION_DEFLATE)
				if raw.size() == raw_size and col.unpack(raw):
					ok = true
					if ver >= 2 and f.get_position() + 4 <= f.get_length():
						var extra_size := f.get_32()
						if extra_size > 0 and f.get_position() + extra_size <= f.get_length():
							var parsed: Variant = JSON.parse_string(f.get_buffer(extra_size).get_string_from_utf8())
							if parsed is Dictionary:
								col.extra = parsed
	f.close()
	if not ok:
		Log.w("SaveManager: corrupt chunk file, regenerating: " + path)
		failed_count += 1
		# Remove it so the column is regenerated and re-saved cleanly next time.
		DirAccess.remove_absolute(ProjectSettings.globalize_path(path) if not path.begins_with("user://") else path)
		return false
	col.from_disk = true
	col.modified = false
	return true

## Writes every modified column. Returns how many files were written.
func save_all(columns: Dictionary) -> int:
	if not enabled:
		return 0
	var n := 0
	for k in columns.keys():
		var col: ChunkColumn = columns[k]
		if col != null and col.modified:
			if save_column(col):
				n += 1
	return n
