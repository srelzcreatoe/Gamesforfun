extends Node
## In-world verification stage: boots a REAL world + player (`Game.start_world`) and then
## runs a transformation on the real `Game.player`, freezing the viewport at chosen times.
## Main has no command line hook for transforming, so this is the way to get an in-game
## shot of the cinematic without touching scenes/main/Main.gd.
##
##   tools/screenshot.sh out.png --sandbox vfx --seconds 40 \
##     --args "--scene=res://scenes/fx/FxWorldStage.tscn --form=supersaiyan.supersaiyan2 \
##             --at=3.4,4.9 --seed=777"
##
## `--at=` seconds are measured from the moment the transformation starts (not from boot),
## so the phase is deterministic however long the world takes to generate.
## `--wait=` seconds to let the world settle before transforming (default 6).
## `--nohud` hides the UiManager for a clean shot.

const DEFAULT_FORM := "supersaiyan.supersaiyan2"

var form_id := DEFAULT_FORM
var seed_text := "777"
var shot_path := ""
var at_times: Array[float] = []
var wait_time := 6.0
var show_hud := true

var _booted := false
var _started := false
var _t := 0.0
var _boot_t := 0.0
var _shots_done := 0
var _capturing := false

func _ready() -> void:
	_parse_args()
	# survive the screen switch Main does when the world is entered
	call_deferred("_reparent_to_root")

func _parse_args() -> void:
	for a in OS.get_cmdline_user_args():
		if not a.begins_with("--"):
			continue
		var kv := a.substr(2).split("=", true, 1)
		var key := kv[0]
		var val := kv[1] if kv.size() > 1 else ""
		match key:
			"form": form_id = val
			"seed": seed_text = val
			"screenshot": shot_path = val
			"wait": wait_time = maxf(1.0, float(val))
			"nohud": show_hud = false
			"at":
				for piece in val.split(",", false):
					var s := piece.strip_edges()
					if s.is_valid_float():
						at_times.append(float(s))
	at_times.sort()
	if at_times.is_empty():
		at_times.append(4.9)

func _reparent_to_root() -> void:
	var parent := get_parent()
	var root := get_tree().root
	if parent != null and root != null and parent != root:
		parent.remove_child(self)
		root.add_child(self)
	_boot_world()

func _boot_world() -> void:
	var info := Game.create_world("FxStage", seed_text, "creative", "normal")
	info["transient"] = true
	var prof: Dictionary = ProfileFactory.new_profile("FxTester", "saiyan", "male", "warrior")
	prof["position"]["planet"] = String(info.get("planet", "earth"))
	Game.start_world(info, prof)
	_booted = true

func _process(delta: float) -> void:
	if not _booted:
		return
	if not _started:
		_boot_t += delta
		if not show_hud and Game.ui != null and Game.ui is CanvasLayer:
			(Game.ui as CanvasLayer).visible = false
		if _boot_t >= wait_time and Game.player != null and is_instance_valid(Game.player):
			_start_transform()
		return
	# the same clamped real-time clock the director uses, so `--at` cannot overshoot:
	# the frame on which the climax hit-stop drops Engine.time_scale to 0.001 used to
	# integrate delta/0.001 and jump the clock tens of seconds past the requested time
	_t += FxAssets.real_delta(delta)
	_maybe_capture()

func _start_transform() -> void:
	_started = true
	var p: Node = Game.player
	Forms.unlock(p, form_id)
	if not Forms.transform(p, form_id):
		print("FXSTAGE could not transform into %s" % form_id)
	else:
		print("FXSTAGE transforming %s at %.2f s" % [form_id, _boot_t])

func _maybe_capture() -> void:
	if _capturing or shot_path == "" or _shots_done >= at_times.size():
		return
	if _t < at_times[_shots_done]:
		return
	_capturing = true
	_capture(at_times[_shots_done])

func _capture(at: float) -> void:
	await RenderingServer.frame_post_draw
	var vp := get_viewport()
	if vp == null:
		_capturing = false
		return
	var img := vp.get_texture().get_image()
	var path := shot_path
	if at_times.size() > 1:
		path = "%s/%s_t%.2f.%s" % [shot_path.get_base_dir(), shot_path.get_basename().get_file(),
			at, shot_path.get_extension()]
	var err := img.save_png(path)
	var d := TransformationDirector.running_for(Game.player)
	print("SCREENSHOT %s -> %s (t=%.2f, phase=%s)" % [path, "ok" if err == OK else str(err), _t,
		d.phase_name() if d != null else "-"])
	_shots_done += 1
	_capturing = false
	if _shots_done >= at_times.size():
		get_tree().quit()
