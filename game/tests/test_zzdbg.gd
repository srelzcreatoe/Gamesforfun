extends TestCase
const FakeWorld := preload("res://tests/QuestTestWorld.gd")
func test_dbg() -> void:
	Game.profile = ProfileFactory.new_profile("T","saiyan","male","warrior")
	Game.world_info = {"slug":"d","planet":"earth","seed":4242,"difficulty":"normal"}
	var w: Node3D = FakeWorld.new(); w.seed = 4242
	add_node(w); Game.world = w
	QuestBoot.install(w)
	var db: DragonBalls = w.get_node_or_null("DragonBalls")
	print("placement script = ", db._placement())
	print("total earth = ", db.total_count("earth"), " cereal = ", db.total_count("cereal"))
	var pos := db.positions("earth")
	for p in pos:
		print("  ", p, " dist=", Vector2((p as Vector3).x, (p as Vector3).z).length())
	w.free(); Game.world = null; Game.profile = {}
