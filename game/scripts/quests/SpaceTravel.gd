class_name SpaceTravel
extends Node
## Space pods, the Capsule Corp ship, the flying nimbus, deep space flight and planet
## travel (docs/ARCHITECTURE.md §9). Lives under the World as "SpaceTravel" (the UI's
## SpaceMap looks it up there).
##
## Unlock rules come from `planets.json.travel.unlock`:
##   ALWAYS | NEVER | QUEST:<quest id> | PLANET:<planet id> | ITEM:<item id>
## plus anything already listed in `Game.profile.planets_unlocked`.

const NODE_NAME := "SpaceTravel"

const LAUNCH_TIME := 2.4
const DESCEND_DIST := 24.0
const MARKER_BASE_RADIUS := 260.0
const MARKER_STEP := 150.0
const COMPASS_INTERVAL := 3.0
const ASCENT_DWELL := 2.5
const ASCENT_MARGIN := 4.0
const SUIT_PIECES := 4.0
const NIMBUS_FLAG := "nimbus_active"

## DMZ Plus body targets that are not planet ids.
const TARGET_ALIASES := {"overworld": "earth", "the_nether": "hell_planet", "the_end": "heaven"}

var world: Node = null
var launching := false
var deep_space := false
var nimbus := false

var _fade: CanvasLayer = null
var _fade_rect: ColorRect = null
var _compass_t := 0.0
var _ascent_t := 0.0
var _markers: Array = []
var _markers_planet := ""

static func of(world_node: Node) -> SpaceTravel:
	if world_node == null or not is_instance_valid(world_node):
		return null
	var n: Node = world_node.get_node_or_null(NODE_NAME)
	return n as SpaceTravel if n is SpaceTravel else null

func _ready() -> void:
	name = NODE_NAME
	if world == null:
		world = get_parent()
	Events.travel_requested.connect(_on_travel_requested)
	Events.ui_opened.connect(_on_ui_opened)
	Events.planet_changed.connect(_on_planet_changed)
	_refresh_planet()

# --- planet / unlock rules -------------------------------------------------

func planet_id() -> String:
	if world != null and is_instance_valid(world) and world.get("planet_id") != null:
		return String(world.get("planet_id"))
	if Game != null:
		return String(Game.world_info.get("planet", "earth"))
	return "earth"

func planet_def(pid := "") -> Dictionary:
	return Registry.planet(pid if pid != "" else planet_id()) if Registry != null else {}

func profile() -> Dictionary:
	return Game.profile if Game != null else {}

func unlocked_list() -> Array:
	var p := profile()
	var arr: Variant = p.get("planets_unlocked", null)
	if not (arr is Array):
		arr = ["earth"]
		p["planets_unlocked"] = arr
	return arr

## {ok, reasons} for travelling to `pid`.
func can_travel(pid: String) -> Dictionary:
	var def := planet_def(pid)
	if def.is_empty():
		return {"ok": false, "reasons": PackedStringArray(["Unknown world"])}
	if pid == planet_id():
		return {"ok": false, "reasons": PackedStringArray(["You are already here"])}
	if unlocked_list().has(pid):
		return {"ok": true, "reasons": PackedStringArray()}
	var rule := String(def.get("travel", {}).get("unlock", "ALWAYS")).strip_edges()
	var kind := rule.get_slice(":", 0).to_upper()
	var arg := rule.substr(rule.find(":") + 1) if rule.contains(":") else ""
	match kind:
		"ALWAYS":
			return {"ok": true, "reasons": PackedStringArray()}
		"NEVER":
			return {"ok": false, "reasons": PackedStringArray(["No route exists"])}
		"QUEST":
			var qid := _resolve_quest(arg)
			var finished: Array = profile().get("quests", {}).get("completed", [])
			var claimed: Array = profile().get("quests", {}).get("claimed", [])
			if qid != "" and (finished.has(qid) or claimed.has(qid)):
				return {"ok": true, "reasons": PackedStringArray()}
			return {"ok": false, "reasons": PackedStringArray(["Finish \"%s\" first" % Requirements.quest_title(qid if qid != "" else arg)])}
		"PLANET":
			if unlocked_list().has(arg) or _visited(arg):
				return {"ok": true, "reasons": PackedStringArray()}
			return {"ok": false, "reasons": PackedStringArray(["Reach %s first" % Requirements.planet_name(arg)])}
		"ITEM":
			if _has_item(arg):
				return {"ok": true, "reasons": PackedStringArray()}
			return {"ok": false, "reasons": PackedStringArray(["Needs %s" % Requirements.item_name(arg)])}
	return {"ok": true, "reasons": PackedStringArray()}

func is_unlocked(pid: String) -> bool:
	if pid == planet_id():
		return true
	return bool(can_travel(pid)["ok"])

func unlocked_planets() -> PackedStringArray:
	var out := PackedStringArray()
	if Registry == null:
		return out
	for pid in Registry.planets.keys():
		if is_unlocked(String(pid)):
			out.append(String(pid))
	return out

func _visited(pid: String) -> bool:
	return StoryFlags.has_flag("visited_" + pid) or unlocked_list().has(pid)

func _has_item(item_id: String) -> bool:
	var p: Node = Game.player if Game != null else null
	if p != null and is_instance_valid(p) and "inventory" in p:
		var inv: Variant = p.get("inventory")
		if inv != null and is_instance_valid(inv as Object) and (inv as Object).has_method("has"):
			return bool((inv as Object).call("has", item_id, 1))
	var ctx_items := Requirements.item_counts(profile(), p)
	return int(ctx_items.get(item_id, 0)) > 0

## planets.json unlock rules use loose quest ids ("buu_saga:23", "bulma_time_chamber_link").
func _resolve_quest(text: String) -> String:
	var qm := QuestManager.of(world)
	if qm != null:
		return qm.resolve_id(text)
	if Registry == null:
		return ""
	if Registry.quests.has(text):
		return text
	var wanted := text.get_slice(":", text.get_slice_count(":") - 1)
	for qid in Registry.quests.keys():
		if String(Registry.quests[qid].get("id", "")) == wanted:
			return String(qid)
	return ""

# --- travel ----------------------------------------------------------------

func open_map(vehicle := "") -> void:
	if Game == null or Game.ui == null:
		return
	Game.ui.call("open", "space_map", {"vehicle": vehicle, "travel": self})

## Item use for space_pod / saiyan_ship / capsule corp ship / nimbus.
func use_vehicle(item_id: String) -> bool:
	var def: Dictionary = Registry.item(item_id) if Registry != null else {}
	var kind := String(def.get("vehicle", ""))
	if kind == "nimbus":
		return mount_nimbus(item_id)
	open_map(item_id)
	return true

## The flying nimbus: free flight without the fly skill while it is active.
func mount_nimbus(item_id := "flying_nimbus") -> bool:
	var p: Node = Game.player if Game != null else null
	if p == null or not is_instance_valid(p):
		return false
	nimbus = not nimbus
	StoryFlags.set_flag(NIMBUS_FLAG, nimbus)
	if "is_flying" in p:
		p.set("is_flying", nimbus)
	if Audio != null:
		Audio.play_sfx("nube", -3.0)
	Events.hint.emit("%s %s" % [Requirements.item_name(item_id), "called" if nimbus else "dismissed"], 2.0)
	return true

## Travel to `pid`: plays the launch cinematic then `Game.change_planet`.
func travel_to(pid: String, arrival: Variant = null) -> bool:
	if launching:
		return false
	var check := can_travel(pid)
	if not bool(check["ok"]):
		var why: PackedStringArray = check["reasons"]
		var text: String = String(why[0]) if why.size() > 0 else "You cannot go there yet"
		if Game != null and Game.ui != null:
			Game.ui.call("show_hint", text, 3.0)
		else:
			Events.hint.emit(text, 3.0)
		return false
	var target: Vector3 = arrival if arrival is Vector3 else arrival_point(pid)
	launching = true
	_play_launch(pid, target)
	return true

## Arrival position: `planets.json.spawn` (y < 0 = "drop onto the surface").
func arrival_point(pid: String) -> Vector3:
	var def := planet_def(pid)
	var sp: Variant = def.get("spawn", null)
	if sp is Array and (sp as Array).size() >= 3:
		var a: Array = sp
		return Vector3(float(a[0]) + 0.5, float(a[1]), float(a[2]) + 0.5)
	return Vector3(0.5, -1.0, 0.5)

func _play_launch(pid: String, target: Vector3) -> void:
	var p: Node = Game.player if Game != null else null
	var pod: Node = null
	if p is Node3D and world != null and world.has_method("spawn_entity") \
			and Registry != null and Registry.entities.has("spacepod"):
		pod = world.call("spawn_entity", "spacepod", (p as Node3D).global_position + Vector3(0, 0.2, 0), {})
	if Audio != null:
		Audio.play_sfx("ui_nave_takeoff", 0.0)
	Events.hint.emit("Leaving for %s" % Requirements.planet_name(pid), 3.0)
	_fade_to_black(LAUNCH_TIME * 0.9)
	if pod is Node3D:
		var t := create_tween()
		t.tween_property(pod, "position:y", (pod as Node3D).position.y + 90.0, LAUNCH_TIME).set_ease(Tween.EASE_IN)
	if p != null and is_instance_valid(p) and "is_flying" in p:
		p.set("is_flying", true)
	get_tree().create_timer(LAUNCH_TIME).timeout.connect(func() -> void:
		_arrive(pid, target), CONNECT_ONE_SHOT)

func _arrive(pid: String, target: Vector3) -> void:
	launching = false
	StoryFlags.set_flag("visited_" + pid, true)
	var arr := unlocked_list()
	if not arr.has(pid):
		arr.append(pid)
		Events.planet_unlocked.emit(pid)
	if Game != null:
		Game.change_planet(pid, target)
	if Audio != null:
		Audio.play_sfx("landing_ship", -2.0)

func _on_travel_requested(pid: String) -> void:
	if pid == "":
		open_map()
		return
	if launching:
		return
	# The SpaceMap emits this and then calls travel_to() itself; only act when it did not.
	call_deferred("_travel_if_idle", pid)

func _travel_if_idle(pid: String) -> void:
	if not launching:
		travel_to(pid)

func _on_ui_opened(screen: String) -> void:
	if screen != "space_map" or Game == null or Game.ui == null:
		return
	var inst: Variant = Game.ui.get("open_screens")
	if not (inst is Dictionary) or not (inst as Dictionary).has("space_map"):
		return
	var node: Variant = (inst as Dictionary)["space_map"]
	if not (node is Node) or not is_instance_valid(node as Node):
		return
	var args: Variant = (node as Node).get("args")
	if not (args is Dictionary):
		return
	var vehicle := String((args as Dictionary).get("vehicle", ""))
	if vehicle == "":
		return
	var kind := String(Registry.item(vehicle).get("vehicle", "")) if Registry != null else ""
	if kind == "nimbus":
		Game.ui.call("close", "space_map")
		mount_nimbus(vehicle)

func _on_planet_changed(_pid: String) -> void:
	_refresh_planet()

func _refreshed_gravity() -> float:
	return float(planet_def().get("gravity", 1.0))

func _refresh_planet() -> void:
	var def := planet_def()
	deep_space = not bool(def.get("oxygen", true)) and _refreshed_gravity() <= 0.01
	_markers = []
	_markers_planet = ""
	_compass_t = 0.0
	_ascent_t = 0.0
	if deep_space:
		Events.hint.emit("Deep space: zero gravity. Watch your oxygen.", 5.0)

# --- deep space ------------------------------------------------------------

## Deterministic marker positions for the current planet's `sky.bodies` with a target.
func body_markers() -> Array:
	var pid := planet_id()
	if _markers_planet == pid and not _markers.is_empty():
		return _markers
	_markers_planet = pid
	_markers = []
	var def := planet_def(pid)
	var bodies: Variant = def.get("sky", {}).get("bodies", [])
	if not (bodies is Array):
		return _markers
	var base_y := arrival_point(pid).y
	if base_y < 0.0:
		base_y = 800.0
	var index := 0
	for b in bodies:
		if not (b is Dictionary):
			continue
		var body: Dictionary = b
		var target := String(body.get("target", ""))
		if target == "":
			continue
		var kind := String(body.get("kind", "planet"))
		var rng := RandomNumberGenerator.new()
		rng.seed = hash("%s/%s" % [pid, target])
		var angle := rng.randf() * TAU
		var radius := MARKER_BASE_RADIUS + MARKER_STEP * float(index) + rng.randf() * 80.0
		var y := base_y + rng.randf_range(-90.0, 90.0)
		_markers.append({
			"target": target,
			"planet": resolve_target(target),
			"kind": kind,
			"texture": String(body.get("texture", "")),
			"position": Vector3(cos(angle) * radius, y, sin(angle) * radius),
			"scale": float(body.get("scale", 40.0)),
		})
		index += 1
	return _markers

## Body target -> planet id ("" when it is not a landable planet).
static func resolve_target(target: String) -> String:
	if target == "":
		return ""
	if TARGET_ALIASES.has(target):
		return String(TARGET_ALIASES[target])
	if target.ends_with("_system"):
		return ""
	if Registry != null and Registry.planets.has(target):
		return target
	return ""

func nearest_body(from: Vector3, landable_only := true) -> Dictionary:
	var best: Dictionary = {}
	var best_d := INF
	for m in body_markers():
		if not (m is Dictionary):
			continue
		var d: Dictionary = m
		if landable_only and String(d.get("planet", "")) == "":
			continue
		var dist: float = from.distance_to(d.get("position", Vector3.ZERO))
		if dist < best_d:
			best_d = dist
			best = d
	if not best.is_empty():
		best = best.duplicate()
		best["distance"] = best_d
	return best

func has_space_suit() -> bool:
	var p: Node = Game.player if Game != null else null
	if p == null or not is_instance_valid(p) or not ("inventory" in p):
		return false
	var inv: Variant = p.get("inventory")
	if inv == null or not is_instance_valid(inv as Object):
		return false
	if (inv as Object).has_method("armor_bonus"):
		return float((inv as Object).call("armor_bonus", "oxygen")) >= SUIT_PIECES
	return false

func _process(delta: float) -> void:
	if Game == null or Game.profile.is_empty() or Game.paused_by_ui:
		return
	var p: Node = Game.player
	if p == null or not is_instance_valid(p) or not (p is Node3D):
		return
	if nimbus and "is_flying" in p and not bool(p.get("is_flying")):
		p.set("is_flying", true)
	if deep_space:
		_tick_deep_space(p as Node3D, delta)
	else:
		_tick_ascent(p as Node3D, delta)

func _tick_deep_space(p: Node3D, delta: float) -> void:
	if "is_flying" in p:
		p.set("is_flying", true)
	if has_space_suit():
		var survival: Variant = p.get("survival") if "survival" in p else null
		if survival != null and is_instance_valid(survival as Object) and "oxygen" in (survival as Object):
			(survival as Object).set("oxygen", 10.0)
	var pos := p.global_position
	var near := nearest_body(pos)
	if near.is_empty():
		return
	if float(near.get("distance", INF)) <= DESCEND_DIST:
		var target := String(near.get("planet", ""))
		if target != "" and not launching:
			Events.hint.emit("Descending to %s" % Requirements.planet_name(target), 3.0)
			travel_to(target)
		return
	_compass_t -= delta
	if _compass_t <= 0.0:
		_compass_t = COMPASS_INTERVAL
		var dir: Vector3 = (near.get("position", Vector3.ZERO) - pos).normalized()
		Events.hint.emit("%s — %.0f m %s" % [Requirements.planet_name(String(near.get("planet", "?"))),
			float(near.get("distance", 0.0)), DragonBalls.compass(dir)], COMPASS_INTERVAL)

## Flying high enough on a planet with an `ascent` block leaves for deep space.
func _tick_ascent(p: Node3D, delta: float) -> void:
	var ascent: Variant = planet_def().get("ascent", null)
	if not (ascent is Dictionary):
		return
	var target := String((ascent as Dictionary).get("deep_space", ""))
	if target == "" or launching:
		return
	var limit := float(planet_def().get("height", WorldConst.HEIGHT)) - ASCENT_MARGIN
	var flying := bool(p.get("is_flying")) if "is_flying" in p else false
	if not flying or p.global_position.y < limit:
		_ascent_t = 0.0
		return
	_ascent_t += delta
	if _ascent_t < ASCENT_DWELL:
		Events.hint.emit("Hold altitude to break the atmosphere...", 1.0)
		return
	_ascent_t = 0.0
	var arr: Variant = (ascent as Dictionary).get("arrival", null)
	var point := arrival_point(target)
	if arr is Array and (arr as Array).size() >= 3:
		var a: Array = arr
		point = Vector3(float(a[0]) + 0.5, float(a[1]), float(a[2]) + 0.5)
	if not unlocked_list().has(target):
		unlocked_list().append(target)
	travel_to(target, point)

# --- fade ------------------------------------------------------------------

func _fade_to_black(seconds: float) -> void:
	if _fade == null or not is_instance_valid(_fade):
		_fade = CanvasLayer.new()
		_fade.name = "TravelFade"
		_fade.layer = 20
		add_child(_fade)
		_fade_rect = ColorRect.new()
		_fade_rect.color = Color(0, 0, 0, 0)
		_fade_rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_fade_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_fade.add_child(_fade_rect)
	_fade_rect.color = Color(0, 0, 0, 0)
	var t := create_tween()
	t.tween_property(_fade_rect, "color:a", 1.0, maxf(0.1, seconds))
	t.tween_property(_fade_rect, "color:a", 0.0, 0.8)
