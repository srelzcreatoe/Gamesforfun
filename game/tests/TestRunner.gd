extends Node
## Headless test runner scene: godot --headless --path game res://tests/TestRunner.tscn -- [filter]
## Runs every tests/test_*.gd (extends TestCase) and quits with exit code 1 on failure.

func _ready() -> void:
	call_deferred("_run")

func _run() -> void:
	var filter := ""
	var ua := OS.get_cmdline_user_args()
	if ua.size() > 0 and not ua[0].begins_with("--"):
		filter = ua[0]
	if not Registry.loaded:
		Registry.load_all()
	if not Textures.built:
		Textures.build_block_array()
	var files := JsonUtil.list_files("res://tests", ".gd", false)
	var total := 0
	var failed := 0
	var all_failures := PackedStringArray()
	for f in files:
		var base := f.get_file()
		if not base.begins_with("test_"):
			continue
		if filter != "" and not base.contains(filter):
			continue
		var script: GDScript = load(f)
		if script == null or not script.can_instantiate():
			all_failures.append("cannot load/compile " + f)
			failed += 1
			continue
		var inst: Variant = script.new()
		if inst == null or not (inst is TestCase):
			all_failures.append(f + " does not extend TestCase")
			failed += 1
			continue
		var tc: TestCase = inst
		if tc.has_method("set_tree"):
			tc.call("set_tree", get_tree())
		for m in script.get_script_method_list():
			var name: String = m["name"]
			if not name.begins_with("test_"):
				continue
			total += 1
			tc.current = base + "::" + name
			var before := tc.failures.size()
			tc.setup()
			var r: Variant = tc.call(name)
			if r is Signal:
				await r
			tc.teardown()
			if tc.failures.size() > before:
				failed += 1
				print("FAIL " + tc.current)
			else:
				print("ok   " + tc.current)
		all_failures.append_array(tc.failures)
	print("---- %d tests, %d failed ----" % [total, failed])
	for fl in all_failures:
		print("  " + fl)
	get_tree().quit(1 if failed > 0 else 0)
