extends TestCase
const T := 6
const N := 20000
const LOCAL_CONST: Array = [[1,2,3],[4,5,6]]
static var STATIC_NESTED: Array = [[1,2,3],[4,5,6]]
var member_nested: Array = [[1,2,3],[4,5,6]]

func _spin(fn: Callable) -> void:
	var ths: Array[Thread] = []
	for i in T:
		var th := Thread.new(); th.start(fn.bind(i)); ths.append(th)
	for th in ths: th.wait_to_finish()

func x_a_other_script_const_vector_elems() -> void:
	print("      --- other-script const, Vector3 elements (FACE_NORMAL)")
	_spin(func(_i: int) -> void:
		var acc := 0.0
		for n in N:
			for f in 6: acc += BlockShapes.FACE_NORMAL[f].x)

func x_b_other_script_const_whole_outer() -> void:
	print("      --- other-script const, copy outer only")
	_spin(func(_i: int) -> void:
		var acc := 0
		for n in N:
			var a: Array = BlockShapes.FACE_CORNERS
			acc += a.size())

func x_c_own_script_const_nested() -> void:
	print("      --- own-script const, nested array element")
	_spin(func(_i: int) -> void:
		var acc := 0
		for n in N:
			for f in 2:
				var a: Array = LOCAL_CONST[f]
				acc += a.size())

func test_d_static_var_nested() -> void:
	print("      --- static var, nested array element")
	_spin(func(_i: int) -> void:
		var acc := 0
		for n in N:
			for f in 2:
				var a: Array = STATIC_NESTED[f]
				acc += a.size())

func test_e_plain_shared_nested() -> void:
	print("      --- plain member Array, nested array element")
	_spin(func(_i: int) -> void:
		var acc := 0
		for n in N:
			for f in 2:
				var a: Array = member_nested[f]
				acc += a.size())

func test_f_local_snapshot_nested() -> void:
	print("      --- per-thread local copy of the nested arrays")
	_spin(func(_i: int) -> void:
		var mine: Array = []
		for f in 6: mine.append((BlockShapes.FACE_CORNERS[f] as Array).duplicate())
		var acc := 0
		for n in N:
			for f in 6:
				var a: Array = mine[f]
				acc += a.size())
