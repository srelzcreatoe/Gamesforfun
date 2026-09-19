class_name CrashReport
extends RefCounted
## Builds the text the player copies out of the "Crash log" menu screen and sends to us.
##
## Sources, in the order they matter for diagnosing a phone-only crash:
##   * device + driver identity (GPU name and driver version decide most Android crashes),
##   * the settings the run used (quality preset, render distance, safe mode),
##   * the PREVIOUS run's breadcrumbs (`user://boot_prev.log`) - the last line is the stage
##     the game died at, which is the single most useful fact,
##   * this run's breadcrumbs so far (`user://boot.log`),
##   * the tail of Godot's own log (`user://logs/*.log`), which carries the engine's
##     ERROR/SHADER lines from the crashed run. That file only exists because
##     `debug/file_logging/enable_file_logging` is on in project.godot.
##
## `Main._rotate_boot_log()` copies boot.log to boot_prev.log at startup, so the crashed
## run survives the relaunch that overwrites boot.log.

const BOOT_LOG := "user://boot.log"
const BOOT_PREV := "user://boot_prev.log"
const CRASH_FILE := "user://crashes.json"
const LOG_DIR := "user://logs"
const ENGINE_LOG_LINES := 140

static func build() -> String:
	var out := PackedStringArray()
	out.append("=== DRAGON BLOCK SAGAS CRASH LOG ===")
	out.append(_device_block())
	out.append("")
	out.append("--- settings ---")
	out.append(_settings_block())
	out.append("")
	out.append("--- previous run (the one that crashed) ---")
	out.append(_file_text(BOOT_PREV, "(no previous run recorded)"))
	out.append("")
	out.append("--- this run so far ---")
	out.append(_file_text(BOOT_LOG, "(no breadcrumbs yet)"))
	out.append("")
	out.append("--- engine log tail ---")
	out.append(_engine_log())
	out.append("=== END ===")
	return "\n".join(out)

static func _device_block() -> String:
	var lines := PackedStringArray()
	lines.append("game %s   engine %s" % [Game.version, Engine.get_version_info().get("string", "?")])
	lines.append("os %s %s   model %s" % [OS.get_name(), OS.get_version(), OS.get_model_name()])
	lines.append("gpu %s" % RenderingServer.get_video_adapter_name())
	lines.append("driver %s (%s)" % [RenderingServer.get_video_adapter_api_version(),
		RenderingServer.get_video_adapter_vendor()])
	lines.append("renderer %s" % ProjectSettings.get_setting("rendering/renderer/rendering_method", "?"))
	lines.append("cpus %d   screen %s   dpi %d" % [OS.get_processor_count(),
		str(DisplayServer.window_get_size()), DisplayServer.screen_get_dpi()])
	lines.append("memory static %.0f MB   textures %.0f MB   buffers %.0f MB" % [
		Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0,
		Performance.get_monitor(Performance.RENDER_TEXTURE_MEM_USED) / 1048576.0,
		Performance.get_monitor(Performance.RENDER_BUFFER_MEM_USED) / 1048576.0])
	var crashes: Variant = JsonUtil.load_file(CRASH_FILE)
	if crashes is Dictionary:
		lines.append("recorded crashes %d" % int((crashes as Dictionary).get("count", 0)))
	return "\n".join(lines)

static func _settings_block() -> String:
	var keys := ["quality_preset", "render_distance", "sim_distance", "bloom", "clouds",
		"fancy_water", "shadows", "particles", "ambient_life", "safe_mode"]
	var parts := PackedStringArray()
	for k in keys:
		parts.append("%s=%s" % [k, str(Game.settings.get(k, "?"))])
	return "  ".join(parts)

static func _file_text(path: String, fallback: String) -> String:
	if not FileAccess.file_exists(path):
		return fallback
	var txt := FileAccess.get_file_as_string(path).strip_edges()
	return txt if not txt.is_empty() else fallback

## The newest engine log that is not the one this run is still writing, falling back to the
## current one when there is only one file.
static func _engine_log() -> String:
	var files := PackedStringArray()
	if DirAccess.dir_exists_absolute(LOG_DIR):
		for f in DirAccess.get_files_at(LOG_DIR):
			if String(f).ends_with(".log"):
				files.append(String(f))
	if files.is_empty():
		return "(engine file logging produced nothing)"
	files.sort()
	var pick: String = files[files.size() - 2] if files.size() >= 2 else files[0]
	var txt := FileAccess.get_file_as_string(LOG_DIR.path_join(pick))
	# Collapse runs of identical lines first: a crashing run floods the log with the same
	# error thousands of times, and the lines BEFORE the flood are the useful ones.
	var lines := txt.split("\n")
	var packed := PackedStringArray()
	var counts := PackedInt32Array()
	for raw in lines:
		var line := String(raw)
		if packed.size() > 0 and packed[packed.size() - 1] == line:
			counts[counts.size() - 1] += 1
		else:
			packed.append(line)
			counts.append(1)
	var start: int = maxi(0, packed.size() - ENGINE_LOG_LINES)
	var tail := PackedStringArray()
	tail.append("(%s, %d lines -> %d after collapsing repeats, showing the last %d)" % [
		pick, lines.size(), packed.size(), mini(ENGINE_LOG_LINES, packed.size())])
	for i in range(start, packed.size()):
		if counts[i] > 1:
			tail.append("%s   [x%d]" % [packed[i], counts[i]])
		else:
			tail.append(packed[i])
	return "\n".join(tail)
