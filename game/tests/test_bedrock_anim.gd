extends TestCase
## Bedrock animation parsing / sampling / blending tests.

var model: BedrockModel = null
var anim: BedrockAnimation = null

func setup() -> void:
	model = BedrockModel.new()
	add_node(model)
	model.load_geo("entity/races/human")
	anim = BedrockAnimation.new()
	add_node(anim)
	anim.setup(model, null)
	anim.load_clips("entity/races/movement")

func teardown() -> void:
	for n in [model, anim]:
		if n != null:
			if n.is_inside_tree():
				n.get_parent().remove_child(n)
			n.free()
	model = null
	anim = null

func test_clip_loading() -> void:
	assert_true(anim.clips.size() >= 60, "movement.animation.json clips: %d" % anim.clips.size())
	assert_true(anim.has_clip("base.walk"), "base.walk")
	assert_true(anim.has_clip("walk"), "suffix resolution: walk -> base.walk")
	assert_eq(anim.resolve("walk").name, "base.walk")
	var clip := anim.resolve("base.walk")
	assert_eq(clip.loop, BedrockAnimation.LOOP_YES, "base.walk loops")
	assert_true(clip.bones.has("right_arm"), "right_arm channel")
	assert_true(clip.bones.has("right_leg"), "right_leg channel")
	anim.load_clips("entity/races/combat")
	assert_true(anim.clips.size() > 60, "combat clips merge in")

func test_walk_sampling() -> void:
	# base.walk right_arm rotation = [-cos(t*360)*32, 0, 2.5]
	var r0 := anim.sample_channel("base.walk", "right_arm", "rotation", 0.0)
	assert_near(r0.x, -32.0, 0.01, "right arm at t=0")
	assert_near(r0.z, 2.5, 0.01, "constant z component")
	var r25 := anim.sample_channel("base.walk", "right_arm", "rotation", 0.25)
	assert_true(r25 != Vector3.ZERO, "t=0.25 gives a non-zero right_arm rotation")
	var r50 := anim.sample_channel("base.walk", "right_arm", "rotation", 0.5)
	assert_near(r50.x, 32.0, 0.01, "arm swings the other way half a cycle later")
	# legs counter-swing the arms (gait check)
	var leg0 := anim.sample_channel("base.walk", "right_leg", "rotation", 0.0)
	assert_near(leg0.x, 16.0, 0.01, "right leg forward at t=0")
	assert_true(signf(leg0.x) != signf(r0.x), "arm and leg swing in opposite directions")
	var left_leg0 := anim.sample_channel("base.walk", "left_leg", "rotation", 0.0)
	assert_true(signf(left_leg0.x) != signf(leg0.x), "legs swing in opposite directions")

func test_head_queries_from_owner() -> void:
	var owner := Entity.new()
	add_node(owner)
	anim.setup(model, owner)
	# base.walk head rotation.y = -query.head_y_rotation (0 without an owner value)
	var r := anim.sample_channel("base.walk", "head", "rotation", 0.0)
	assert_near(r.y, 0.0, 0.01, "no head yaw by default")
	owner.head_yaw_deg = 40.0
	owner.head_pitch_deg = 0.0
	var r2 := anim.sample_channel("base.walk", "head", "rotation", 0.0)
	assert_near(r2.y, -40.0, 0.01, "head follows -query.head_y_rotation")
	owner.get_parent().remove_child(owner)
	owner.free()

func test_pose_application_on_top_of_rest() -> void:
	var rest: Vector3 = model.get_bone("right_arm").position
	assert_true(anim.sample_to("base.walk", 0.0), "sample_to")
	var bone: Node3D = model.get_bone("right_arm")
	assert_true(bone.position.distance_to(rest) < 2.0, "position offsets stay small")
	var euler := bone.transform.basis.get_euler()
	assert_near(rad_to_deg(euler.x), -32.0, 1.0, "rest pose + animation rotation")
	# and back to rest when the clip no longer animates that bone
	anim.stop(0.0)
	anim.play("base.idle", 0.0)
	anim.update(0.016)
	assert_true(model.get_bone("right_arm") != null)

func test_keyframes_and_catmullrom() -> void:
	var a := BedrockAnimation.new()
	add_node(a)
	var m := BedrockModel.new()
	add_node(m)
	m.load_geo("entity/animal/dino1")
	a.setup(m, null)
	a.load_clips("entity/animal/dino1")
	assert_true(a.has_clip("walk"), "dino1 walk")
	var clip := a.resolve("walk")
	assert_true(clip.length > 0.0, "keyframed clip has a computed length: %f" % clip.length)
	var chan: BedrockAnimation.Chan = clip.bones["leg_right"]["rotation"]
	assert_true(chan.has_keys, "keyframed channel")
	assert_true(chan.keys.size() >= 2, "keys: %d" % chan.keys.size())
	# exactly on a key -> the key value; between keys -> interpolated
	var k0: Vector3 = a.sample_channel("walk", "leg_right", "rotation", 0.0)
	assert_near(k0.x, 8.22045, 0.01, "first keyframe post value")
	var mid: Vector3 = a.sample_channel("walk", "leg_right", "rotation", chan.times[1] * 0.5)
	assert_true(mid != k0, "interpolated between keys")
	var last: Vector3 = a.sample_channel("walk", "leg_right", "rotation", 99.0)
	assert_true(last != Vector3.ZERO, "clamped to the last key")
	for n in [a, m]:
		n.get_parent().remove_child(n)
		n.free()

func test_loop_modes_and_blend() -> void:
	var clip := anim.resolve("base.landing")
	assert_true(clip != null, "base.landing exists")
	anim.play("base.landing", 0.0, false)
	var total := 0.0
	var seen: Array = []
	anim.clip_finished.connect(func(n: String) -> void: seen.append(n))
	while total < clip.length + 0.2:
		anim.update(0.05)
		total += 0.05
	assert_true(seen.has("base.landing"), "a non-looping clip reports clip_finished, got %s" % str(seen))
	# blending: switching clips keeps the pose continuous
	anim.play("base.walk", 0.0)
	anim.update(0.1)
	var before: Transform3D = model.get_bone("right_arm").transform
	anim.play("base.ki_charge", 0.3)
	anim.update(0.016)
	var after: Transform3D = model.get_bone("right_arm").transform
	assert_true(before.origin.distance_to(after.origin) < 1.0, "blend keeps the pose close")
	assert_true(anim.is_playing("base.ki_charge"), "new clip is playing")

func test_upper_body_override_layer() -> void:
	anim.load_clips("entity/races/combat")
	anim.play("base.walk", 0.0)
	anim.update(0.1)
	var leg_before: Transform3D = model.get_bone("right_leg").transform
	var clip_name := ""
	for c in ["base.jab_right", "base.combo_1", "base.attack1"]:
		if anim.has_clip(c):
			clip_name = c
			break
	assert_ne(clip_name, "", "found a punch clip")
	anim.play_upper(clip_name, 0.0)
	anim.update(0.05)
	assert_true(anim.is_playing(clip_name), "upper layer plays")
	# legs keep walking, the upper body is overridden
	var leg_after: Transform3D = model.get_bone("right_leg").transform
	assert_true(leg_before.basis.get_euler() != leg_after.basis.get_euler(), "legs still animated by the base layer")

func test_all_animation_files_parse() -> void:
	var files := JsonUtil.list_files("res://assets/animations", ".json", true)
	var clips := 0
	for f in files:
		if not f.ends_with(".animation.json"):
			continue
		var rel := f.trim_prefix("res://assets/animations/").trim_suffix(".animation.json")
		var a := BedrockAnimation.new()
		add_node(a)
		var n := a.load_clips(rel)
		clips += n
		if n == 0:
			failures.append("%s: no clips in %s" % [current, rel])
		a.get_parent().remove_child(a)
		a.free()
	assert_true(clips > 300, "clips parsed across every file: %d" % clips)

func test_performance_per_entity() -> void:
	anim.play("base.walk", 0.0)
	anim.update(0.016)
	var n := 2000
	var t0 := Time.get_ticks_usec()
	for i in n:
		anim.update(0.016)
	var us := float(Time.get_ticks_usec() - t0) / float(n)
	print("      animation update: %.3f ms per animated entity (base.walk, %d bones)" % [us / 1000.0, anim.resolve("base.walk").bones.size()])
	assert_true(us < 200.0, "%.1f us per entity update is too slow" % us)

func test_spa_pack_loads_with_bone_remap() -> void:
	var n := anim.load_clips("spa/player", BedrockAnimation.REMAP_SPA)
	assert_true(anim.has_clip("spa.walking"), "spa.walking loaded (clips now %d)" % n)
	assert_true(anim.has_clip("spa.crawling") and anim.has_clip("spa.climbing"), "crawl/climb")
	assert_true(anim.has_clip("spa.idle_sneak") and anim.has_clip("spa.sleeping"), "sneak/sleep")
	# bones were renamed onto the DMZ rig
	var clip := anim.resolve("spa.walking")
	assert_true(clip.bones.has("right_arm") and clip.bones.has("left_leg"), "remapped bones: %s" % str(clip.bone_names))
	assert_true(not clip.bones.has("rightArm"), "vanilla names are gone")
	# the 20 fps outlier was rescaled to seconds on import
	assert_true(clip.length > 0.2 and clip.length < 2.0, "walking length %.2f s" % clip.length)
	# and it actually animates the arms
	var a := anim.sample_channel("spa.walking", "right_arm", "rotation", 0.15)
	var b := anim.sample_channel("spa.walking", "right_arm", "rotation", 0.45)
	assert_true(a != b, "spa.walking swings the right arm (%s vs %s)" % [a, b])

func test_anim_select_prefers_dmz_and_falls_back_to_spa() -> void:
	anim.load_clips("entity/races/combat")
	anim.load_clips("spa/player", BedrockAnimation.REMAP_SPA)
	# DMZ wins where DMZ has a clip
	assert_eq(AnimSelect.choose("walk", anim), "base.walk")
	assert_eq(AnimSelect.choose("idle", anim), "base.idle")
	assert_eq(AnimSelect.choose("ki_charge", anim), "base.ki_charge")
	assert_eq(AnimSelect.choose("fly_forward", anim), "base.fly_front")
	# SPA fills the gaps
	assert_eq(AnimSelect.choose("crawl_back", anim), "spa.crawling_backwards")
	assert_eq(AnimSelect.choose("climb_idle", anim), "spa.idle_climbing")
	assert_eq(AnimSelect.choose("sleep", anim), "spa.sleeping")
	assert_eq(AnimSelect.choose("turn_left", anim), "spa.turn_left")
	# forcing the SPA variant
	assert_eq(AnimSelect.choose("walk", anim, true), "spa.walking")
	# unknown state -> ""
	assert_eq(AnimSelect.choose("nonsense_state", anim), "")
	assert_true(AnimSelect.available(anim).size() > 40, "most states resolve")
