extends TestCase
## Temporary micro-benchmark (deleted before the final hand-off).

func test_bench() -> void:
	var n := 20000
	var code := PackedInt32Array()
	for i in 11:
		code.append(i % 4)
	var st := PackedFloat32Array()
	st.resize(32)
	var arr: Array[float] = []
	arr.resize(32)
	var t0 := Time.get_ticks_usec()
	for k in n:
		for i in 11:
			pass
	print("      empty loop 11:      %.3f us" % (float(Time.get_ticks_usec() - t0) / n))
	t0 = Time.get_ticks_usec()
	var acc := 0
	for k in n:
		for i in code.size():
			acc += code[i]
	print("      packedint read:     %.3f us" % (float(Time.get_ticks_usec() - t0) / n))
	t0 = Time.get_ticks_usec()
	for k in n:
		for i in 11:
			st[i] = st[i] + 1.0
	print("      packedfloat rw:     %.3f us" % (float(Time.get_ticks_usec() - t0) / n))
	t0 = Time.get_ticks_usec()
	for k in n:
		for i in 11:
			arr[i] = arr[i] + 1.0
	print("      typed array rw:     %.3f us" % (float(Time.get_ticks_usec() - t0) / n))
	t0 = Time.get_ticks_usec()
	for k in n:
		for i in 11:
			match code[i]:
				0: acc += 1
				1: acc += 2
				2: acc += 3
				_: acc += 4
	print("      match 4:            %.3f us" % (float(Time.get_ticks_usec() - t0) / n))
	var d := {&"query.anim_time": 0.5}
	t0 = Time.get_ticks_usec()
	for k in n:
		for i in 11:
			acc += int(float(d.get(&"query.anim_time", 0.0)))
	print("      dict get x11:       %.3f us" % (float(Time.get_ticks_usec() - t0) / n))
	var m := Molang.compile("-math.cos(query.anim_time *360) * 32 - query.head_y_rotation*0.25")
	var ctx := {&"query.anim_time": 0.25, &"query.head_y_rotation": 10.0}
	t0 = Time.get_ticks_usec()
	for k in n:
		m.evaluate(ctx)
	print("      molang 11 ops:      %.3f us" % (float(Time.get_ticks_usec() - t0) / n))
	var m2 := Molang.compile("-query.head_y_rotation*0.5")
	t0 = Time.get_ticks_usec()
	for k in n:
		m2.evaluate(ctx)
	print("      molang 3 ops:       %.3f us" % (float(Time.get_ticks_usec() - t0) / n))
	assert_true(true)
