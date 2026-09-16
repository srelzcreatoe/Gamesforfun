class_name TestCase
extends RefCounted
## Minimal test base. Subclasses define methods starting with "test_".

var failures: PackedStringArray = PackedStringArray()
var current := ""
var tree: SceneTree = null

func set_tree(t: SceneTree) -> void:
	tree = t

## Add a node to the running scene tree (for tests that need nodes); free it in teardown.
func add_node(n: Node) -> Node:
	if tree != null:
		tree.root.add_child(n)
	return n

func assert_true(cond: bool, msg := "") -> void:
	if not cond:
		failures.append("%s: expected true. %s" % [current, msg])

func assert_eq(a: Variant, b: Variant, msg := "") -> void:
	if a != b:
		failures.append("%s: expected %s == %s. %s" % [current, str(a), str(b), msg])

func assert_ne(a: Variant, b: Variant, msg := "") -> void:
	if a == b:
		failures.append("%s: expected %s != %s. %s" % [current, str(a), str(b), msg])

func assert_near(a: float, b: float, eps := 0.001, msg := "") -> void:
	if absf(a - b) > eps:
		failures.append("%s: expected %f ~= %f. %s" % [current, a, b, msg])

func setup() -> void:
	pass

func teardown() -> void:
	pass
