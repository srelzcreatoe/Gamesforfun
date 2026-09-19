extends TestCase
## Audio director tests: the BGM context decision with fake world states, the ambience
## layer weights with fake world states, footstep material mapping, and a data check
## that every sound/playlist the audio subsystem references really exists on disk
## (so a headless run never prints "Missing audio").

const SFX_DIR := "res://assets/audio/sfx/"
const BGM_DIR := "res://assets/audio/bgm/"

## Every logical sfx name the audio subsystem can play.
const USED_SFX: Array[String] = [
	"ui_menu_switch", "quest_start", "quest_complete", "level_up", "toast",
	"item_pickup", "dball_pickup", "skill_learned", "land", "splash", "swim",
]

var _owned: Array[Node] = []

## Nodes created by a test: freed immediately in teardown (queue_free would never run,
## the runner quits the tree right after the last test).
func _own(n: Node) -> Node:
	_owned.append(n)
	return n

func teardown() -> void:
	for n in _owned:
		if is_instance_valid(n):
			if n.get_parent() != null:
				n.get_parent().remove_child(n)
			n.free()
	_owned.clear()

func _state(overrides: Dictionary = {}) -> Dictionary:
	var st := {
		"in_world": true,
		"planet": "earth",
		"planet_music": "explore_earth",
		"gravity": 1.0,
		"transformation": false,
		"boss": false,
		"battle": false,
		"deep_space": false,
	}
	for k in overrides:
		st[k] = overrides[k]
	return st

# --- BGM context decision ---------------------------------------------------

func test_decide_menu_when_no_world() -> void:
	assert_eq(BgmDirector.decide({}), "", "no world -> Main owns the music")
	assert_eq(BgmDirector.decide({"in_world": false}), "")

func test_decide_planet_music() -> void:
	assert_eq(BgmDirector.decide(_state()), "explore_earth")
	assert_eq(BgmDirector.decide(_state({"planet": "namek", "planet_music": "namek"})), "namek")
	assert_eq(BgmDirector.decide(_state({"planet": "heaven", "planet_music": "heaven"})), "heaven")
	assert_eq(BgmDirector.decide(_state({"planet": "hell_planet", "planet_music": "hell"})), "hell")
	assert_eq(BgmDirector.decide(_state({"planet": "time_chamber", "planet_music": "time_chamber"})), "time_chamber")
	assert_eq(BgmDirector.decide(_state({"planet": "otherworld", "planet_music": "otherworld"})), "otherworld")
	assert_eq(BgmDirector.decide(_state({"planet_music": ""})), "explore", "fallback context")

func test_decide_deep_space() -> void:
	var st := _state({"planet": "orbit", "planet_music": "space", "deep_space": true, "gravity": 0.0})
	assert_eq(BgmDirector.decide(st), "space")
	# deep space still loses against combat
	st["battle"] = true
	assert_eq(BgmDirector.decide(st), "battle")

func test_decide_priority_order() -> void:
	assert_eq(BgmDirector.decide(_state({"battle": true})), "battle")
	assert_eq(BgmDirector.decide(_state({"battle": true, "boss": true})), "boss")
	assert_eq(BgmDirector.decide(_state({"battle": true, "boss": true, "transformation": true})), "transformation")
	assert_eq(BgmDirector.decide(_state({"transformation": true})), "transformation")
	assert_eq(BgmDirector.decide(_state({"override": "sad", "boss": true})), "sad", "explicit override wins")

func test_priority_and_hold() -> void:
	assert_true(BgmDirector.priority_of("transformation") > BgmDirector.priority_of("boss"))
	assert_true(BgmDirector.priority_of("boss") > BgmDirector.priority_of("battle"))
	assert_true(BgmDirector.priority_of("battle") > BgmDirector.priority_of("explore_earth"))
	assert_eq(BgmDirector.hold_needed("", "explore_earth"), 0.0, "first context is immediate")
	assert_eq(BgmDirector.hold_needed("transformation", "explore_earth"), 0.0, "cinematic restores at once")
	assert_eq(BgmDirector.hold_needed("explore_earth", "battle"), 0.0, "urgent context interrupts")
	assert_eq(BgmDirector.hold_needed("battle", "explore_earth"), BgmDirector.MIN_HOLD)
	assert_eq(BgmDirector.hold_needed("explore_earth", "namek"), BgmDirector.MIN_HOLD)

func test_resolve_context_falls_back_to_a_real_playlist() -> void:
	assert_eq(BgmDirector.resolve_context(""), "")
	assert_eq(BgmDirector.resolve_context("explore_earth"), "explore_earth")
	assert_eq(BgmDirector.resolve_context("does_not_exist"), BgmDirector.FALLBACK_CONTEXT)

func test_hysteresis_no_flip_flopping() -> void:
	var d := BgmDirector.new()
	d.apply_audio = false
	_own(add_node(d))
	var explore := _state()
	assert_eq(d.update_context(0.016, explore), "explore_earth", "first context immediately")
	# a fight starts: urgent, takes over at once
	assert_eq(d.update_context(0.016, _state({"battle": true})), "battle")
	# the fight ends after 2 s: battle music must hold
	assert_eq(d.update_context(2.0, explore), "battle", "battle holds for MIN_HOLD")
	assert_eq(d.update_context(3.0, explore), "battle")
	# ... and only switches back after the minimum hold time
	assert_eq(d.update_context(BgmDirector.MIN_HOLD, explore), "explore_earth")
	# boss beats battle immediately, transformation beats boss immediately
	assert_eq(d.update_context(0.1, _state({"battle": true})), "battle")
	assert_eq(d.update_context(0.1, _state({"battle": true, "boss": true})), "boss")
	assert_eq(d.update_context(0.1, _state({"boss": true, "transformation": true})), "transformation")
	# the cinematic ends -> restore without waiting
	assert_eq(d.update_context(0.1, _state({"boss": true})), "boss")

func test_no_world_keeps_the_menu_music() -> void:
	var d := BgmDirector.new()
	d.apply_audio = false
	_own(add_node(d))
	assert_eq(d.update_context(1.0, {"in_world": false}), "", "director stays idle in menus")
	assert_eq(d.context(), "")

# --- ambience layers --------------------------------------------------------

func _amb(overrides: Dictionary = {}) -> Dictionary:
	var st := {
		"in_world": true,
		"planet": "earth",
		"biome": "plains",
		"gravity": 1.0,
		"sky_light": 15,
		"y": 70.0,
		"surface_y": 70.0,
		"weather": "clear",
		"water_near": 0.0,
		"underwater": false,
	}
	for k in overrides:
		st[k] = overrides[k]
	return st

func _dominant(weights: Dictionary) -> String:
	var best := ""
	var best_w := 0.0
	for k in weights:
		if float(weights[k]) > best_w:
			best_w = float(weights[k])
			best = String(k)
	return best

func test_ambience_silent_outside_a_world() -> void:
	var w := Ambience.compute_weights({"in_world": false})
	for k in w:
		assert_eq(float(w[k]), 0.0, "layer %s must be silent in menus" % k)

func test_ambience_wind_on_open_ground() -> void:
	var w := Ambience.compute_weights(_amb())
	assert_true(float(w["wind"]) > 0.5, "plains are windy: " + str(w))
	assert_eq(float(w["cave"]), 0.0)
	assert_eq(float(w["rain"]), 0.0)
	var forest := Ambience.compute_weights(_amb({"biome": "dark_forest"}))
	assert_true(float(forest["wind"]) < float(w["wind"]), "forests are more sheltered")
	var high := Ambience.compute_weights(_amb({"biome": "mountains", "y": 150.0, "surface_y": 150.0}))
	assert_true(float(high["wind"]) >= float(w["wind"]), "altitude adds wind")

func test_ambience_unlit_surface_still_has_wind() -> void:
	# an ungenerated / unlit column reports sky light 0 - on the surface that is still open sky
	var w := Ambience.compute_weights(_amb({"sky_light": 0, "y": 63.0, "surface_y": 63.0, "biome": ""}))
	assert_true(float(w["wind"]) > 0.4, "surface with no light data must still be windy: " + str(w))
	assert_eq(float(w["cave"]), 0.0)

func test_ambience_cave_underground() -> void:
	var w := Ambience.compute_weights(_amb({"sky_light": 0, "y": 30.0, "surface_y": 70.0}))
	assert_eq(_dominant(w), "cave", str(w))
	assert_eq(float(w["wind"]), 0.0, "no wind underground")

func test_ambience_ocean_near_water() -> void:
	var w := Ambience.compute_weights(_amb({"biome": "beach", "water_near": 1.0}))
	assert_true(float(w["ocean"]) > 0.7, str(w))
	var dry := Ambience.compute_weights(_amb({"biome": "desert", "water_near": 0.0}))
	assert_eq(float(dry["ocean"]), 0.0)
	var under := Ambience.compute_weights(_amb({"biome": "ocean", "underwater": true, "water_near": 1.0}))
	assert_eq(float(under["ocean"]), 1.0)
	assert_eq(float(under["wind"]), 0.0)

func test_ambience_rain_during_weather() -> void:
	var w := Ambience.compute_weights(_amb({"weather": "rain"}))
	assert_eq(float(w["rain"]), 1.0, str(w))
	var thunder := Ambience.compute_weights(_amb({"weather": "thunder"}))
	assert_eq(float(thunder["rain"]), 1.0)
	var cave_rain := Ambience.compute_weights(_amb({"weather": "rain", "sky_light": 0, "y": 20.0, "surface_y": 70.0}))
	assert_true(float(cave_rain["rain"]) < 1.0, "rain is muffled underground")
	var snow := Ambience.compute_weights(_amb({"weather": "snow", "biome": "snowy_plains"}))
	assert_eq(float(snow["rain"]), 0.0, "snow is silent, it only adds wind")
	assert_true(float(snow["wind"]) > 0.5)
	# Weather.gd may already own a rain loop: do not double it
	var external := Ambience.compute_weights(_amb({"weather": "rain", "external_rain": true}))
	assert_eq(float(external["rain"]), 0.0)

func test_ambience_planet_flavours() -> void:
	var space := Ambience.compute_weights(_amb({"planet": "universe_7_deep_space", "biome": "deep_space", "gravity": 0.0}))
	assert_eq(_dominant(space), "space", str(space))
	assert_eq(float(space["wind"]), 0.0)
	var hell := Ambience.compute_weights(_amb({"planet": "hell_planet", "biome": "hell_planet_wastes"}))
	assert_eq(float(hell["hell"]), 1.0, str(hell))
	var heaven := Ambience.compute_weights(_amb({"planet": "heaven", "biome": "heaven_meadows"}))
	assert_eq(float(heaven["heaven"]), 1.0, str(heaven))
	var kai := Ambience.compute_weights(_amb({"planet": "otherworld", "biome": "king_kai_planet"}))
	assert_eq(float(kai["heaven"]), 1.0, str(kai))

func test_ambience_node_runs_without_a_world() -> void:
	var a := Ambience.new()
	_own(add_node(a))
	a._process(0.1)
	a.sample_interval = 1000.0   # stop sampling the (absent) live world
	assert_eq(a.dominant_layer(), "", "silent without a world")
	a.apply_state(_amb({"weather": "rain"}))
	for i in 200:
		a._process(0.05)
	assert_eq(a.dominant_layer(), "rain", "weights reach the players: " + str(a.layer_weights()))

# --- footsteps --------------------------------------------------------------

func test_footstep_sound_per_material() -> void:
	for mat in Footsteps.MATERIALS:
		assert_eq(Footsteps.sound_for(String(mat)), "step_" + String(mat))
	assert_eq(Footsteps.sound_for("unobtainium"), "step_stone", "unknown material falls back")
	assert_eq(Footsteps.material_at(null, Vector3.ZERO), "stone", "no world -> default material")

func test_footstep_pitch_variation() -> void:
	var seen: Dictionary = {}
	for i in 40:
		var p := Footsteps.pitch_for("stone")
		assert_true(p >= 0.85 and p <= 1.25, "pitch out of range: %f" % p)
		seen[snappedf(p, 0.001)] = true
	assert_true(seen.size() > 5, "pitch must vary between steps")
	assert_true(Footsteps.pitch_for("snow") > 0.0)
	assert_true(Footsteps.volume_db_for("stone") < 0.0, "steps are quiet (0.35 linear)")
	assert_true(Footsteps.step_distance(true) > Footsteps.step_distance(false), "sprinting strides are longer")

func test_footstep_material_from_fake_world() -> void:
	var w := FakeWorld.new()
	_own(add_node(w))
	var stone := Registry.block_id("stone")
	var snow := Registry.block_id("snow_block")
	if snow < 0:
		snow = Registry.block_id("snow")
	w.blocks[Vector3i(0, 63, 0)] = stone
	assert_eq(Footsteps.material_at(w, Vector3(0.5, 64.0, 0.5)), "stone")
	if snow > 0:
		w.blocks[Vector3i(0, 63, 0)] = snow
		assert_eq(Footsteps.material_at(w, Vector3(0.5, 64.0, 0.5)),
			String(Registry.block(snow).get("material", "?")))
	var stepper := Footsteps.Stepper.new()
	var played := false
	for i in 20:
		played = stepper.advance(0.1, 4.0, true, w, Vector3(0.5, 64.0, 0.5)) or played
	assert_true(played, "the stepper plays steps while running")
	assert_eq(stepper.advance(0.1, 4.0, false, w, Vector3(0.5, 64.0, 0.5)), false, "no steps in the air")

class FakeWorld extends Node3D:
	var blocks: Dictionary = {}
	func get_block(x: int, y: int, z: int) -> int:
		return int(blocks.get(Vector3i(x, y, z), 0))
	func get_biome(_x: int, _z: int) -> String:
		return "plains"

# --- data: every referenced sound exists ------------------------------------

func _sfx_files(logical: String) -> Array:
	var sfx: Dictionary = Registry.audio.get("sfx", {})
	if not sfx.has(logical):
		return []
	var v: Variant = sfx[logical]
	if v is Array:
		return v
	return [String(v)]

func _audio_exists(dir: String, file: String) -> bool:
	return ResourceLoader.exists(dir + file + ".ogg") or ResourceLoader.exists(dir + file + ".wav")

func test_every_sfx_we_play_exists() -> void:
	var names: Array[String] = USED_SFX.duplicate()
	for mat in Footsteps.MATERIALS:
		names.append(Footsteps.sound_for(String(mat)))
	for layer in Ambience.LAYERS:
		names.append(String(Ambience.LAYERS[layer]["sfx"]))
	for n in names:
		var files := _sfx_files(n)
		assert_true(files.size() > 0, "audio.json has no sfx entry '%s'" % n)
		for f in files:
			assert_true(_audio_exists(SFX_DIR, String(f)),
				"missing audio file for '%s': %s%s" % [n, SFX_DIR, String(f)])

func test_every_bgm_context_we_pick_has_tracks() -> void:
	var contexts: Array[String] = ["explore", "battle", "boss", "transformation", "space"]
	for p in Registry.planets.values():
		var m := String((p as Dictionary).get("music", ""))
		if m != "" and not contexts.has(m):
			contexts.append(m)
	var lists: Dictionary = Registry.audio.get("bgm", {})
	for c in contexts:
		var tracks: Array = lists.get(c, [])
		assert_true(tracks.size() > 0, "audio.json has no bgm playlist for context '%s'" % c)
		assert_eq(BgmDirector.resolve_context(c), c, "context '%s' should resolve to itself" % c)
		for t in tracks:
			assert_true(_audio_exists(BGM_DIR, String(t)),
				"missing bgm file for '%s': %s%s" % [c, BGM_DIR, String(t)])

func test_director_attaches_and_creates_ambience() -> void:
	var host := Node.new()
	_own(add_node(host))
	var d := BgmDirector.attach(host)
	assert_ne(d, null)
	d.set("apply_audio", false)
	assert_eq(BgmDirector.attach(host), d, "attach is idempotent")
	assert_ne(d.get_node_or_null("Ambience"), null, "the director owns the ambience node")
	d.call("_process", 0.016)
	assert_eq(d.call("context"), "", "no world -> no context")

# --- event sounds: signatures + no missing files at runtime ------------------

func test_event_sounds_play_without_missing_audio() -> void:
	var d := BgmDirector.new()
	_own(add_node(d))
	var before: Dictionary = {}
	for k in Audio._streams:
		before[k] = true
	# every feedback hook the brief assigns to the audio director
	Events.ui_opened.emit("inventory")
	d._clock += 1.0
	Events.ui_closed.emit("inventory")
	d._clock += 1.0
	Events.quest_started.emit("saga_saiyan:1")
	d._clock += 1.0
	Events.quest_completed.emit("saga_saiyan:1")
	d._clock += 1.0
	Events.level_up.emit(4)
	d._clock += 1.0
	Events.toast.emit("Title", "Text", null)
	d._clock += 1.0
	Events.item_picked_up.emit("senzu_bean", 1)
	d._clock += 1.0
	Events.item_picked_up.emit("dball1", 1)
	d._clock += 1.0
	Events.dragon_ball_found.emit("earth", 4)
	d._clock += 1.0
	Events.technique_learned.emit("kamehameha")
	# a missing file is cached as null by Audio._stream (and logs "Missing audio")
	for k in Audio._streams:
		if before.has(k):
			continue
		assert_ne(Audio._streams[k], null, "Missing audio file: " + String(k))
	assert_true(Audio._streams.size() > before.size(), "the director should have played sounds")
	# ducking follows the dialog events
	Events.dialog_requested.emit(null)
	for i in 30:
		d._process(0.05)
	assert_true(d.duck_factor() < 0.5, "music ducks during dialogs: %f" % d.duck_factor())
	Events.dialog_closed.emit(null)
	for i in 30:
		d._process(0.05)
	assert_near(d.duck_factor(), 1.0, 0.02, "ducking is released")
	# release what this test loaded into the Audio cache/pool so the engine does not
	# report leaked resources when the test runner quits the tree
	for k in Audio._streams.keys():
		if not before.has(k):
			Audio._streams.erase(k)
	for sp in Audio._pool:
		sp.stop()
		sp.stream = null

func test_decision_cost_is_negligible() -> void:
	var st := _state({"battle": true})
	var amb := _amb({"weather": "rain"})
	var t0 := Time.get_ticks_usec()
	for i in 5000:
		BgmDirector.decide(st)
		Ambience.compute_weights(amb)
	var us := float(Time.get_ticks_usec() - t0) / 5000.0
	print("   decide+compute_weights: %.2f us per call" % us)
	assert_true(us < 40.0, "audio decisions must stay cheap: %f us" % us)
