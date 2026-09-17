class_name AmbientPool
extends RefCounted
## Fixed-size node pool for the one-shot ambient effects (splashes, ripples, debris puffs,
## footstep dust, embers, wisps, shooting stars).
##
## Nodes are created once, parented once and then recycled forever: `acquire()` hands back an
## idle node, `release()` puts it back. Nothing is allocated or freed while the game runs, which
## is the whole point — `_process` of the ambient layer must not touch the allocator.

var parent: Node = null
var factory: Callable = Callable()
var max_size: int = 8

var _all: Array[Node] = []
var _free: Array[Node] = []
var _busy: Dictionary = {}          ## node instance id -> true

func _init(p: Node, f: Callable, size: int) -> void:
	parent = p
	factory = f
	max_size = maxi(1, size)

func size() -> int:
	return _all.size()

func free_count() -> int:
	return _free.size()

func busy_count() -> int:
	return _busy.size()

## An idle node, growing the pool lazily up to max_size. Returns null when everything is busy.
func acquire() -> Node:
	while _free.size() > 0:
		var n: Node = _free.pop_back()
		if is_instance_valid(n):
			_busy[n.get_instance_id()] = true
			return n
	if _all.size() >= max_size or parent == null or not factory.is_valid():
		return null
	var made: Variant = factory.call()
	if not (made is Node):
		return null
	var node: Node = made
	parent.add_child(node)
	_all.append(node)
	_busy[node.get_instance_id()] = true
	return node

func release(n: Node) -> void:
	if n == null or not is_instance_valid(n):
		return
	if not _busy.erase(n.get_instance_id()):
		return
	if not _free.has(n):
		_free.append(n)

## Release every busy node (world unload / planet change).
func release_all() -> void:
	for n in _all:
		if is_instance_valid(n) and not _free.has(n):
			_free.append(n)
	_busy.clear()

func nodes() -> Array[Node]:
	return _all

func clear() -> void:
	for n in _all:
		if is_instance_valid(n):
			n.queue_free()
	_all.clear()
	_free.clear()
	_busy.clear()
