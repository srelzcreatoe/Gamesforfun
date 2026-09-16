extends TestCase
## EnemyAI state machine, Animal behaviour, Npc interaction and Spawner, driven
## with a fake target instead of a real Player.

const RADITZ := "saga_raditz"

var nodes: Array = []

func teardown() -> void:
	for n in nodes:
		if n != null and is_instance_valid(n):
			if n.is_inside_tree():
				n.get_parent().remove_child(n)
			n.free()
	nodes.clear()

func _keep(n: Node) -> Node:
	nodes.append(n)
	return n

func _enemy(tier := 1, type := RADITZ, parent: Node = null) -> Enemy:
	var e := Enemy.new()
	e.entity_type = type
	e.apply_spawn_data({"ai_tier": tier})
	if parent != null:
		parent.add_child(e)
	else:
		add_node(e)
	_keep(e)
	e.global_position = Vector3(0, 64, 0)
	return e

func _dummy(pos: Vector3, health := 1000.0) -> Entity:
	var d := Entity.new()
	add_node(d)
	_keep(d)
	d.global_position = pos
	d.max_health = health
	d.health = health
	d.faction = "player"
	d.aabb_size = Vector3(0.6, 1.8, 0.6)
	return d

func test_ai_starts_idle_and_wanders() -> void:
	var e := _enemy()
	assert_true(e.ai != null, "AI created")
	assert_eq(e.ai.state, EnemyAI.IDLE, "starts idle")
	for i in 200:
		e.ai.tick(0.05)
		if e.ai.state == EnemyAI.WANDER:
			break
	assert_eq(e.ai.state, EnemyAI.WANDER, "idle times out into wander")

func test_provoke_chases_and_attacks() -> void:
	var e := _enemy()
	var t := _dummy(Vector3(10, 64, 0))
	e.set_target(t)
	e.ai.provoke(t)
	assert_eq(e.ai.state, EnemyAI.CHASE, "provoked -> CHASE")
	# chasing must close the distance
	var d0 := e.global_position.distance_to(t.global_position)
	for i in 120:
		e.ai.tick(1.0 / 30.0)
		e.apply_physics(1.0 / 30.0)
	var d1 := e.global_position.distance_to(t.global_position)
	assert_true(d1 < d0, "moved closer: %f -> %f" % [d0, d1])
	# once in range it switches to ATTACK and keeps ~2 m
	t.global_position = e.global_position + Vector3(0, 0, -2.0)
	for i in 10:
		e.ai.tick(1.0 / 30.0)
	assert_eq(e.ai.state, EnemyAI.ATTACK, "within keep distance -> ATTACK")

func test_melee_hit_window_damages_the_target() -> void:
	var e := _enemy()
	var t := _dummy(Vector3(0, 64, -2.0))
	e.set_target(t)
	e.ai.provoke(t)
	e.ai.set_state(EnemyAI.ATTACK)
	var before := t.health
	var hit := false
	for i in 200:
		e.ai.tick(1.0 / 30.0)
		t.invuln = 0.0
		if t.health < before:
			hit = true
			break
	assert_true(hit, "the melee combo damaged the target (%f -> %f)" % [before, t.health])

func test_ranged_attack_spawns_a_projectile() -> void:
	var host := Node3D.new()
	add_node(host)
	_keep(host)
	var e := _enemy(1, RADITZ, host)
	var t := _dummy(Vector3(0, 64, -12.0))
	e.set_target(t)
	e.ai.provoke(t)
	# isolate the built-in fallback from the combat engineer's Techniques.gd
	EnemyAI._tech_checked = true
	var saved: Object = EnemyAI._techniques
	EnemyAI._techniques = null
	e.ai.blast_cd = 0.0
	var fired: Array = []
	Events.technique_fired.connect(func(_n: Node, id: String) -> void: fired.append(id))
	e.ai.tick(0.05)
	EnemyAI._techniques = saved
	var projectiles := 0
	for c in host.get_children():
		if c is SimpleProjectile:
			projectiles += 1
	assert_true(projectiles >= 1, "spawned the placeholder blast, children=%d" % host.get_child_count())
	assert_true(fired.size() >= 1, "Events.technique_fired emitted")
	assert_true(e.ai.blast_cd > 1.0, "blast cooldown reset")

func test_tier2_beam_telegraph() -> void:
	var host := Node3D.new()
	add_node(host)
	_keep(host)
	var e := _enemy(2, RADITZ, host)
	var t := _dummy(Vector3(0, 64, -12.0))
	e.set_target(t)
	e.ai.provoke(t)
	EnemyAI._tech_checked = true
	var saved: Object = EnemyAI._techniques
	EnemyAI._techniques = null
	e.ai._begin_beam()
	assert_near(e.ai.beam_time, EnemyAI.BEAM_TELEGRAPH, 0.001, "1.2 s telegraph")
	for i in 30:
		e.ai.tick(0.05)
	EnemyAI._techniques = saved
	assert_true(e.ai.beam_time < 0.0, "beam fired after the telegraph")

func test_retreat_when_low_and_tier2() -> void:
	var e := _enemy(2)
	var t := _dummy(Vector3(0, 64, -3.0))
	e.set_target(t)
	e.ai.provoke(t)
	e.health = e.max_health * 0.1
	e.ai.tick(0.05)
	assert_eq(e.ai.state, EnemyAI.RETREAT, "tier 2 under 20 %% hp retreats")
	assert_true(e.is_flying or not e.can_fly, "flies away when it can fly")
	# it powers back up and returns to the fight
	for i in 400:
		e.ai.tick(0.05)
		if e.ai.state == EnemyAI.CHASE:
			break
	assert_eq(e.ai.state, EnemyAI.CHASE, "returns to CHASE after retreating")

func test_tier2_dodges_and_tier3_blocks() -> void:
	var e := _enemy(2)
	var attacker := _dummy(Vector3(0, 64, -2.0))
	var dodges := 0
	for i in 200:
		e.invuln = 0.0
		e.dodge_cd = 0.0
		e.health = e.max_health
		if e.take_damage(10.0, attacker, "melee") == 0.0:
			dodges += 1
	assert_true(dodges > 20, "tier 2 dodges roughly 30 %% of melee hits, got %d/200" % dodges)
	var e3 := _enemy(3)
	var blocked := 0
	var full := 0
	for i in 200:
		e3.invuln = 0.0
		e3.dodge_cd = 99.0        # isolate blocking from dodging
		e3.health = e3.max_health
		var applied := e3.take_damage(100.0, attacker, "melee")
		if applied > 0.0 and applied < 50.0:
			blocked += 1
		elif applied >= 50.0:
			full += 1
	assert_true(blocked > 20, "tier 3 blocks some hits, got %d/200" % blocked)
	assert_true(full > 50, "tier 3 still takes full damage most of the time, got %d/200" % full)

func test_boss_events_and_phases() -> void:
	var e := _enemy(2)
	e.is_boss = true
	e.taunt = "You will pay!"
	var engaged: Array = []
	var toasts: Array = []
	Events.boss_engaged.connect(func(n: Node) -> void: engaged.append(n))
	Events.toast.connect(func(_t: String, text: String, _i: Texture2D) -> void: toasts.append(text))
	e.on_aggro()
	assert_eq(engaged.size(), 1, "Events.boss_engaged emitted")
	assert_true(toasts.size() >= 1 and String(toasts[0]).contains("pay"), "taunt toast")
	var defeated: Array = []
	Events.boss_defeated.connect(func(n: Node) -> void: defeated.append(n))
	e.die(null)
	assert_eq(defeated.size(), 1, "Events.boss_defeated emitted")

func test_animal_flees_and_dinos_fight_back() -> void:
	var rabbit := Animal.new()
	rabbit.entity_type = "namekfrog" if Registry.entities.has("namekfrog") else ""
	add_node(rabbit)
	_keep(rabbit)
	rabbit.global_position = Vector3(0, 64, 0)
	rabbit.aggressive = false
	rabbit.on_damaged(null, 5.0)
	assert_eq(rabbit.state, Animal.FLEE, "a peaceful animal flees when hit")
	var dino := Animal.new()
	dino.entity_type = "dino1" if Registry.entities.has("dino1") else ""
	add_node(dino)
	_keep(dino)
	dino.global_position = Vector3(0, 64, 0)
	assert_true(dino.aggressive, "dinos are aggressive")
	dino.on_damaged(null, 5.0)
	assert_eq(dino.state, Animal.CHASE, "an aggressive animal chases when hit")

func test_npc_interaction_and_invulnerability() -> void:
	var npc := Npc.new()
	npc.entity_type = "master_roshi" if Registry.entities.has("master_roshi") else ""
	add_node(npc)
	_keep(npc)
	npc.global_position = Vector3(0, 64, 0)
	assert_true(npc.invulnerable, "masters are invulnerable by default")
	assert_eq(npc.take_damage(100.0, null, "melee"), 0.0, "takes no damage")
	var asked: Array = []
	Events.dialog_requested.connect(func(n: Node) -> void: asked.append(n))
	npc.interact(null)
	assert_eq(asked.size(), 1, "interact raises dialog_requested")
	if Registry.entities.has("master_roshi"):
		assert_eq(npc.master_id, "roshi", "master id from entities.json")

func test_spawner_quest_enemy_and_weights() -> void:
	var sp := Spawner.new()
	add_node(sp)
	_keep(sp)
	sp.enabled = false
	var picks := {"a": 0, "b": 0}
	for i in 400:
		var p := sp._weighted_pick([{"entity": "a", "weight": 9}, {"entity": "b", "weight": 1}])
		picks[String(p["entity"])] += 1
	assert_true(picks["a"] > picks["b"] * 3, "weighted pick respects weights: %s" % str(picks))
	# no world -> no spawn, but no crash either
	assert_eq(sp.try_spawn(), null, "no player/world -> no spawn")
	assert_eq(sp.spawn_quest_enemy(RADITZ, Vector3(0, 64, 0)), null, "no world -> null")
	assert_true(sp.find_spawn_position(Vector3(0, 64, 0)).length() > 0.0, "fallback spawn position")
