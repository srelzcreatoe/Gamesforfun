class_name JsonUtil
## JSON helpers used by Registry and SaveManager.

static func load_file(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return null
	var txt := f.get_as_text()
	f.close()
	var json := JSON.new()
	var err := json.parse(txt)
	if err != OK:
		Log.e("JSON parse error in %s line %d: %s" % [path, json.get_error_line(), json.get_error_message()])
		return null
	return json.data

static func save_file(path: String, data: Variant, pretty := false) -> bool:
	var dir := path.get_base_dir()
	if not DirAccess.dir_exists_absolute(dir):
		DirAccess.make_dir_recursive_absolute(dir)
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		Log.e("Cannot write " + path)
		return false
	f.store_string(JSON.stringify(data, "\t" if pretty else ""))
	f.close()
	return true

static func list_files(dir_path: String, ext := ".json", recursive := true) -> PackedStringArray:
	var out := PackedStringArray()
	var d := DirAccess.open(dir_path)
	if d == null:
		return out
	d.list_dir_begin()
	var name := d.get_next()
	while name != "":
		if d.current_is_dir():
			if recursive and not name.begins_with("."):
				out.append_array(list_files(dir_path.path_join(name), ext, true))
		elif name.ends_with(ext):
			out.append(dir_path.path_join(name))
		name = d.get_next()
	d.list_dir_end()
	out.sort()
	return out

static func color_from_hex(hex: String, fallback := Color.WHITE) -> Color:
	if hex == null or hex == "":
		return fallback
	if Color.html_is_valid(hex):
		return Color.html(hex)
	return fallback
