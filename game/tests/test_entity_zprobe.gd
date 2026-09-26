extends TestCase
## TEMPORARY diagnostic probe (deleted before the final report).

func test_signs() -> void:
	var combos := [Vector3(1, 1, 1), Vector3(-1, -1, 1), Vector3(1, -1, -1)]
	var ids: Array = Registry.entities.keys()
	ids.sort()
	for c in combos:
		BedrockModel.euler_signs = c
		BedrockModel._geo_cache.clear()
		BedrockModel._mesh_cache.clear()
		var total := 0.0
		var bad := 0
		var worst: Array = []
		for id in ids:
			var path := String(Registry.entity(String(id)).get("model", ""))
			if path == "":
				continue
			var m := BedrockModel.new()
			add_node(m)
			if m.load_geo(path):
				var box := m.visual_aabb()
				var w: float = m.bounds_size.x * 0.5
				var h: float = m.bounds_size.y
				var off: Vector3 = m.bounds_offset
				var lo := Vector3(-w, off.y - h * 0.5, -w)
				var hi := Vector3(w, off.y + h * 0.5, w)
				var over := 0.0
				for axis in 3:
					over += maxf(0.0, lo[axis] - box.position[axis])
					over += maxf(0.0, (box.position[axis] + box.size[axis]) - hi[axis])
				if String(id) != "toronbo":
					total += over
					if over > 0.05:
						bad += 1
						worst.append([over, String(id)])
			m.queue_free()
		worst.sort_custom(func(a, b): return float(a[0]) > float(b[0]))
		print("SIGNS %s  overflow(excl toronbo)=%.3f m  entities_out_of_bounds=%d  worst=%s" % [
			str(c), total, bad, str(worst.slice(0, 8))])
	BedrockModel.euler_signs = Vector3.ONE
	BedrockModel._geo_cache.clear()
	BedrockModel._mesh_cache.clear()
