class_name AmbientBudget
extends RefCounted
## One global cap on everything the ambient system draws, so the "alive" layer can never cost
## more than a fixed slice of the frame no matter how many effects fire at once.
##
## A "quad" is one camera-facing sprite: one particle, one mote instance, one bird. A butterfly
## costs two (it is two wing quads). Categories are served in priority order: the steady world
## dressing gets what is left after the reactive one-shots (a splash you caused must never be
## dropped because a butterfly field was full).

const DEFAULT_CAP := 350

## Served first (highest priority last in this list is NOT how it works: index 0 = served first).
const PRIORITY: Array[String] = ["reactive", "leaves", "motes", "butterflies", "birds", "sky"]

var cap: int = DEFAULT_CAP
var used: Dictionary = {}          ## category -> quads currently alive

func _init(quad_cap: int = DEFAULT_CAP) -> void:
	cap = maxi(1, quad_cap)
	reset()

func reset() -> void:
	used.clear()
	for c in PRIORITY:
		used[c] = 0

func total() -> int:
	var n := 0
	for c in used.keys():
		n += int(used[c])
	return n

func free_quads() -> int:
	return maxi(0, cap - total())

## Quads still available to `category`, counting the reservations of higher-priority categories
## plus whatever this category already holds (so a category can always keep what it has).
func available(category: String) -> int:
	var rank := PRIORITY.find(category)
	if rank < 0:
		rank = PRIORITY.size()
	var blocked := 0
	for i in PRIORITY.size():
		if i < rank:
			blocked += int(used.get(PRIORITY[i], 0))
	# Lower-priority categories do not block us, but they are still alive right now, so subtract
	# them too; they are asked to shrink on the next tick.
	for i in range(rank + 1, PRIORITY.size()):
		blocked += int(used.get(PRIORITY[i], 0))
	return maxi(0, cap - blocked)

## Grant at most `want` quads to `category`, replacing whatever it held before. Returns the grant.
func claim(category: String, want: int) -> int:
	used[category] = 0
	var granted := clampi(want, 0, available(category))
	used[category] = granted
	return granted

## Add `n` quads to a category without releasing what it holds (one-shot effects).
## Returns how many were actually granted (0 when the budget is exhausted).
func take(category: String, n: int) -> int:
	if n <= 0:
		return 0
	var room := mini(n, free_quads())
	if room <= 0:
		return 0
	used[category] = int(used.get(category, 0)) + room
	return room

func give_back(category: String, n: int) -> void:
	used[category] = maxi(0, int(used.get(category, 0)) - n)

func describe() -> String:
	var parts := PackedStringArray()
	for c in PRIORITY:
		var n := int(used.get(c, 0))
		if n > 0:
			parts.append("%s %d" % [c, n])
	return "%d/%d (%s)" % [total(), cap, " ".join(parts)]
