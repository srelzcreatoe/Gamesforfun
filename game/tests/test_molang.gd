extends TestCase
## Molang compiler/evaluator tests, using real expressions grepped out of the DMZ
## animation files.

func test_numbers_and_arithmetic() -> void:
	assert_near(Molang.compile("1").evaluate({}), 1.0)
	assert_near(Molang.compile("2.5").evaluate({}), 2.5)
	assert_near(Molang.compile("-7").evaluate({}), -7.0)
	assert_near(Molang.compile("2+3*4").evaluate({}), 14.0)
	assert_near(Molang.compile("(2+3)*4").evaluate({}), 20.0)
	assert_near(Molang.compile("10/4").evaluate({}), 2.5)
	assert_near(Molang.compile("-(3+4)*-2").evaluate({}), 14.0)
	assert_near(Molang.compile("1-2-3").evaluate({}), -4.0)
	assert_near(Molang.compile("8/4/2").evaluate({}), 1.0)
	assert_true(Molang.compile("2+3*4").is_constant, "constant folding")

func test_math_functions_in_degrees() -> void:
	assert_near(Molang.compile("math.sin(90)").evaluate({}), 1.0)
	assert_near(Molang.compile("math.cos(180)").evaluate({}), -1.0)
	assert_near(Molang.compile("math.abs(-3.5)").evaluate({}), 3.5)
	assert_near(Molang.compile("math.clamp(5, 0, 2)").evaluate({}), 2.0)
	assert_near(Molang.compile("math.lerp(0, 10, 0.25)").evaluate({}), 2.5)
	assert_near(Molang.compile("math.mod(7, 3)").evaluate({}), 1.0)
	assert_near(Molang.compile("math.sqrt(16)").evaluate({}), 4.0)
	assert_near(Molang.compile("math.floor(3.7)").evaluate({}), 3.0)
	assert_near(Molang.compile("math.pow(2, 10)").evaluate({}), 1024.0)
	assert_near(Molang.compile("math.min(3, -1)").evaluate({}), -1.0)
	assert_near(Molang.compile("math.max(3, -1)").evaluate({}), 3.0)
	var r := Molang.compile("math.random(2, 3)").evaluate({})
	assert_true(r >= 2.0 and r <= 3.0, "random in range, got %f" % r)
	assert_true(not Molang.compile("math.random(0,1)").is_constant, "random is not folded")
	# case insensitive (the DMZ files contain "Math.sin")
	assert_near(Molang.compile("Math.sin(90)").evaluate({}), 1.0)

func test_variables_and_namespaces() -> void:
	var ctx := {"query.anim_time": 0.5, "variable.foo": 3.0}
	assert_near(Molang.compile("query.anim_time*2").evaluate(ctx), 1.0)
	assert_near(Molang.compile("q.anim_time*2").evaluate(ctx), 1.0, 0.001, "q. alias")
	assert_near(Molang.compile("variable.foo").evaluate(ctx), 3.0)
	assert_near(Molang.compile("v.foo").evaluate(ctx), 3.0, 0.001, "v. alias")
	assert_near(Molang.compile("variable.unknown").evaluate(ctx), 0.0, 0.001, "default 0")
	assert_near(Molang.compile("query.is_on_ground").evaluate({"query.is_on_ground": true}), 1.0)

func test_comparisons_logic_ternary() -> void:
	assert_near(Molang.compile("1 < 2").evaluate({}), 1.0)
	assert_near(Molang.compile("2 <= 1").evaluate({}), 0.0)
	assert_near(Molang.compile("3 == 3").evaluate({}), 1.0)
	assert_near(Molang.compile("3 != 3").evaluate({}), 0.0)
	assert_near(Molang.compile("1 && 0").evaluate({}), 0.0)
	assert_near(Molang.compile("1 || 0").evaluate({}), 1.0)
	assert_near(Molang.compile("1 > 0 ? 5 : 9").evaluate({}), 5.0)
	assert_near(Molang.compile("0 ? 5 : 9").evaluate({}), 9.0)
	assert_near(Molang.compile("0 ? 1 : 0 ? 2 : 3").evaluate({}), 3.0, 0.001, "nested ternary")
	assert_near(Molang.compile("query.is_on_ground ? 10 : 20").evaluate({"query.is_on_ground": 0.0}), 20.0)

func test_real_dmz_expressions() -> void:
	# entity/races/movement.animation.json base.walk / base.idle / base.run
	var ctx := {"query.anim_time": 0.25, "query.head_y_rotation": 40.0, "query.head_x_rotation": 10.0}
	assert_near(Molang.compile("-query.head_y_rotation*0.5").evaluate(ctx), -20.0)
	assert_near(Molang.compile("-query.head_y_rotation/4").evaluate(ctx), -10.0)
	# math.cos(120 - t*180) * -7 with t = 0.25 -> cos(75) * -7
	assert_near(Molang.compile("math.cos(120-query.anim_time *180) *-7").evaluate(ctx), cos(deg_to_rad(75.0)) * -7.0)
	# 10 + sin(t*90*2 - 120) * -5
	assert_near(Molang.compile("10+math.sin(query.anim_time*90*2-120)*-5").evaluate(ctx),
			10.0 + sin(deg_to_rad(0.25 * 90.0 * 2.0 - 120.0)) * -5.0)
	# base.walk waist rotation y
	assert_near(Molang.compile("-math.cos(query.anim_time *360) * 7.5 - (query.head_y_rotation*0.5)").evaluate(ctx),
			-cos(deg_to_rad(90.0)) * 7.5 - 20.0)
	# base.walk head rotation x
	assert_near(Molang.compile("-math.cos(query.anim_time *720)*1.5+5 - query.head_x_rotation").evaluate(ctx),
			-cos(deg_to_rad(180.0)) * 1.5 + 5.0 - 10.0)
	# base.run right_arm (sign matters for the swing direction)
	assert_near(Molang.compile("-math.cos(query.anim_time *360) * 32").evaluate({"query.anim_time": 0.0}), -32.0)
	assert_near(Molang.compile("-math.cos(query.anim_time *360) * 32").evaluate({"query.anim_time": 0.5}), 32.0)

func test_every_expression_in_the_animation_files_compiles() -> void:
	var files := JsonUtil.list_files("res://assets/animations", ".json", true)
	assert_true(files.size() > 10, "found animation files: %d" % files.size())
	var count := 0
	var bad := 0
	var ctx := {"query.anim_time": 0.3, "query.life_time": 1.0, "query.head_x_rotation": 5.0, "query.head_y_rotation": -5.0}
	for f in files:
		var raw: Variant = JsonUtil.load_file(f)
		if not (raw is Dictionary):
			continue
		for s in _collect_strings(raw):
			if not _looks_like_expression(s):
				continue
			count += 1
			var m := Molang.compile(s)
			if m.error != "":
				bad += 1
				if bad < 5:
					failures.append("%s: %s" % [current, m.error])
			var v := m.evaluate(ctx)
			if is_nan(v) or is_inf(v):
				failures.append("%s: %s evaluated to %f" % [current, s, v])
	assert_true(count > 300, "expressions checked: %d" % count)
	assert_eq(bad, 0, "expressions that failed to compile")

func _looks_like_expression(s: String) -> bool:
	return s.contains("query.") or s.contains("q.") or s.contains("math.") or s.contains("Math.")

func _collect_strings(v: Variant) -> PackedStringArray:
	var out := PackedStringArray()
	if v is String:
		out.append(v)
	elif v is Array:
		for x in v:
			out.append_array(_collect_strings(x))
	elif v is Dictionary:
		for x in v.values():
			out.append_array(_collect_strings(x))
	return out

func test_performance() -> void:
	var m := Molang.compile("-math.cos(query.anim_time *360) * 32 - query.head_y_rotation*0.25")
	var ctx := {"query.anim_time": 0.0, "query.head_y_rotation": 10.0}
	var t0 := Time.get_ticks_usec()
	var n := 20000
	for i in n:
		ctx["query.anim_time"] = float(i) * 0.001
		m.evaluate(ctx)
	var us := float(Time.get_ticks_usec() - t0) / float(n)
	print("      molang: %.3f us per evaluation" % us)
	assert_true(us < 20.0, "%.3f us per evaluation is too slow" % us)
