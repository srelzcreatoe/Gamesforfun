class_name DragonBalls
extends Node
## Dragon balls, the radar and the summoning ritual (docs/ARCHITECTURE.md §9).
## Lives under the World as "DragonBalls" (the player's Interaction looks it up there).
##
## Per-set state in `Game.profile.dragon_balls`:
##   {"<set>": {found: [star...], placed: [{star, x, y, z}], scatter: int,
##              next_summon_day: int, summons: int}}
##
## Positions are deterministic from the world seed, the set id and the `scatter`
## counter, so a ball is always in the same place until the dragon scatters them for
## one in-game week (StoryFlags days). Sets: earth, namek, super (deep space), cereal.

const NODE_NAME := "DragonBalls"
const BALL_COUNT := 7
const SCATTER_DAYS := 7
const SPAWN_DIST := 110.0              ## pickups appear this close to the player
const DESPAWN_DIST := 170.0
const RITUAL_RADIUS := 7.0
const PLACE_DIST := 3.6
const PLACE_PICKUP_DELAY := 6.0
const SUPER_PICK_DIST := 46.0
const TICK := 0.75
const ALTAR_BLOCK := "dragon_ball_altar"
const DEFAULT_RANGES := {"earth": 1100.0, "namek": 820.0, "cereal": 820.0, "super": 5200.0, "fused": 1100.0}

var world: Node = null
var dragon: Node = null
var wishes_left := 0
var current_dragon := ""
var summon_origin := Vector3.ZERO

var _tick := 0.0
var _spawned: Dictionary = {}          ## "<set>:<star>" -> instance id
var _item_cache: Dictionary = {}
var _radar: RadarOverlay = null
var _darkened := false

static func of(world_node: Node) -> DragonBalls:
	if world_node == null or not is_instance_valid(world_node):
		return null
	var n: Node = world_node.get_node_or_null(NODE_NAME)
	return n as DragonBalls if n is DragonBalls else null

func _ready() -> void:
	name = NODE_NAME
	if world == null:
		world = get_parent()
	Events.dragon_ball_found.connect(_on_ball_found)
	Events.item_picked_up.connect(_on_item_picked_up)

# --- state -----------------------------------------------------------------

func all_state() -> Dictionary:
	if Game == null or Game.profile.is_empty():
		return {}
	var d: Variant = Game.profile.get("dragon_balls", null)
	if not (d is Dictionary):
		d = {}
		Game.profile["dragon_balls"] = d
	return d

func set_state(set_id: String) -> Dictionary:
	var all := all_state()
	if all.is_empty():
		return {}
	var s: Variant = all.get(set_id, null)
	if not (s is Dictionary):
		s = {"found": [], "placed": [], "scatter": 0, "next_summon_day": 0, "summons": 0}
		all[set_id] = s
	var d: Dictionary = s
	for key in ["found", "placed"]:
		if not (d.get(key, null) is Array):
			d[key] = []
	for key in ["scatter", "next_summon_day", "summons"]:
		if not d.has(key):
			d[key] = 0
	return d

func found(set_id: String) -> Array:
	return set_state(set_id).get("found", [])

func found_count(set_id: String) -> int:
	return found(set_id).size()

func has_all(set_id: String) -> bool:
	return found_count(set_id) >= BALL_COUNT

func placed(set_id: String) -> Array:
	return set_state(set_id).get("placed", [])

## True while the dragon has scattered this set (no balls exist for a week).
func is_scattered(set_id: String) -> bool:
	return StoryFlags.day_index() < int(set_state(set_id).get("next_summon_day", 0))

func days_until_return(set_id: String) -> int:
	return maxi(0, int(set_state(set_id).get("next_summon_day", 0)) - StoryFlags.day_index())

# --- sets / planets --------------------------------------------------------

func planet_id() -> String:
	if world != null and is_instance_valid(world) and world.get("planet_id") != null:
		return String(world.get("planet_id"))
	if Game != null:
		return String(Game.world_info.get("planet", "earth"))
	return "earth"

## The dragon ball set that belongs to the current planet ("" when it has none).
func set_for_planet(pid := "") -> String:
	var p := pid if pid != "" else planet_id()
	if Registry == null:
		return ""
	return String(Registry.planet(p).get("dragon_balls", ""))

func dragon_for_set(set_id: String) -> String:
	if Registry == null:
		return ""
	for did in Registry.wishes.keys():
		if String(Registry.wishes[did].get("ball_set", "")) == set_id:
			return String(did)
	return ""

func range_for_set(set_id: String) -> float:
	return float(DEFAULT_RANGES.get(set_id, 1000.0))

func world_seed() -> int:
	if world != null and is_instance_valid(world) and world.get("seed") != null:
		return int(world.get("seed"))
	if Game != null:
		return int(Game.world_info.get("seed", 0))
	return 0

## Item id of a ball, e.g. ("earth", 4) -> "dball4". "" when the set has no items.
func ball_item(set_id: String, star: int) -> String:
	var key := "%s:%d" % [set_id, star]
	if _item_cache.has(key):
		return String(_item_cache[key])
	var found_id := ""
	if Registry != null:
		for iid in Registry.items.keys():
			var def: Dictionary = Registry.items[iid]
			if String(def.get("kind", "")) != "dragon_ball":
				continue
			var db: Dictionary = def.get("dragon_ball", {})
			if String(db.get("set", "")) == set_id and int(db.get("star", 0)) == star:
				found_id = String(iid)
				break
	_item_cache[key] = found_id
	return found_id

# --- deterministic positions ----------------------------------------------

## The 7 ball positions of a set (x/z world coordinates, y = -1 = "resolve on spawn").
func positions(set_id: String) -> Array:
	var out: Array = []
	var st := set_state(set_id)
	var rng := RandomNumberGenerator.new()
	rng.seed = hash("%d/%s/%d" % [world_seed(), set_id, int(st.get("scatter", 0))])
	var r := range_for_set(set_id)
	for i in BALL_COUNT:
		var angle := rng.randf() * TAU
		var dist: float = sqrt(rng.randf()) * r
		var x: float = roundf(cos(angle) * dist) + 0.5
		var z: float = roundf(sin(angle) * dist) + 0.5
		out.append(Vector3(x, -1.0, z))
	return out

func position_of(set_id: String, star: int) -> Vector3:
	var list := positions(set_id)
	var i := clampi(star - 1, 0, list.size() - 1)
	return list[i] if list.size() > 0 else Vector3.ZERO

# --- radar -----------------------------------------------------------------

## {ok, dir, distance, star, found, total, text}
func radar_direction(from: Vector3, set_id := "") -> Dictionary:
	var sid := set_id if set_id != "" else set_for_planet()
	var total := BALL_COUNT
	if sid == "":
		return {"ok": false, "found": 0, "total": total, "text": "No dragon balls on this world."}
	var st := set_state(sid)
	if is_scattered(sid):
		return {"ok": false, "found": 0, "total": total,
			"text": "The dragon balls are stone for %d more day(s)." % days_until_return(sid)}
	var have: Array = st.get("found", [])
	var best := Vector3.ZERO
	var best_d := INF
	var best_star := 0
	var list := positions(sid)
	for i in list.size():
		var star := i + 1
		if have.has(star):
			continue
		var p: Vector3 = list[i]
		var flat := Vector2(p.x - from.x, p.z - from.z)
		var d := flat.length()
		if d < best_d:
			best_d = d
			best_star = star
			best = Vector3(p.x - from.x, 0.0, p.z - from.z)
	if best_star == 0:
		return {"ok": false, "found": have.size(), "total": total,
			"text": "All seven! Place them together to summon the dragon."}
	var dir := best.normalized() if best.length() > 0.001 else Vector3.FORWARD
	return {"ok": true, "dir": dir, "distance": best_d, "star": best_star,
		"found": have.size(), "total": total,
		"text": "%d★ ball %s at %.0f m — %d/%d found" % [best_star, compass(dir), best_d, have.size(), total]}

static func compass(dir: Vector3) -> String:
	var a := rad_to_deg(atan2(dir.x, -dir.z))
	if a < 0.0:
		a += 360.0
	var names := ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
	return names[int(round(a / 45.0)) % 8]

## Radar item use: opens the overlay and returns the one-line readout for the hint.
func radar_readout(from: Vector3, set_id := "") -> String:
	var info := radar_direction(from, set_id)
	open_radar(set_id if set_id != "" else set_for_planet())
	if Audio != null:
		Audio.play_sfx("dragonradar", -6.0)
	return String(info.get("text", "No signal."))

func open_radar(set_id := "") -> void:
	var sid := set_id if set_id != "" else set_for_planet()
	if Game != null and Game.ui != null and ResourceLoader.exists("res://scenes/ui/Radar.tscn"):
		Game.ui.call("open", "radar", {"set": sid, "balls": self})
		return
	if _radar != null and is_instance_valid(_radar):
		_radar.refresh(self, sid)
		return
	_radar = RadarOverlay.new()
	_radar.balls = self
	_radar.set_id = sid
	add_child(_radar)

# --- ball entities ---------------------------------------------------------

func _process(delta: float) -> void:
	if Game == null or Game.profile.is_empty():
		return
	if Game.paused_by_ui:
		return
	_tick -= delta
	if _tick > 0.0:
		return
	_tick = TICK
	var sid := set_for_planet()
	if sid == "":
		return
	if sid == "super":
		_tick_super(sid)
		return
	_stream_balls(sid)

## Spawn/despawn the pickup entities of the unfound balls around the player.
func _stream_balls(set_id: String) -> void:
	if is_scattered(set_id):
		_clear_spawned(set_id)
		return
	var p: Node = Game.player
	if p == null or not is_instance_valid(p) or not (p is Node3D):
		return
	var origin: Vector3 = (p as Node3D).global_position
	var have: Array = found(set_id)
	var list := positions(set_id)
	for i in list.size():
		var star := i + 1
		var key := "%s:%d" % [set_id, star]
		var pos: Vector3 = list[i]
		var d := Vector2(pos.x - origin.x, pos.z - origin.z).length()
		var live: Object = instance_from_id(int(_spawned.get(key, 0))) if _spawned.has(key) else null
		if live != null and not is_instance_valid(live):
			live = null
			_spawned.erase(key)
		if have.has(star) or _is_placed(set_id, star):
			if live != null and live is Node:
				(live as Node).queue_free()
				_spawned.erase(key)
			continue
		if d <= SPAWN_DIST and live == null:
			var node := _spawn_ball(set_id, star, pos)
			if node != null:
				_spawned[key] = int(node.get_instance_id())
		elif d > DESPAWN_DIST and live != null and live is Node:
			(live as Node).queue_free()
			_spawned.erase(key)

func _spawn_ball(set_id: String, star: int, pos: Vector3) -> Node:
	var item := ball_item(set_id, star)
	if item == "" or world == null or not world.has_method("spawn_entity"):
		return null
	var ground := pos
	if world.has_method("is_area_loaded") and not bool(world.call("is_area_loaded", pos, 1.0)):
		return null
	if world.has_method("get_height"):
		var h := int(world.call("get_height", int(floor(pos.x)), int(floor(pos.z))))
		if h <= 0:
			return null
		ground.y = float(h) + 0.25
	var node: Variant = world.call("spawn_entity", "dragon_ball", ground, {"item": item, "count": 1})
	if not (node is Node):
		return null
	Log.i("DragonBalls: %s %d★ spawned at %s" % [set_id, star, str(ground)])
	return node as Node

func _clear_spawned(set_id: String) -> void:
	for key in _spawned.keys().duplicate():
		if not String(key).begins_with(set_id + ":"):
			continue
		var node: Object = instance_from_id(int(_spawned[key]))
		if node != null and is_instance_valid(node) and node is Node:
			(node as Node).queue_free()
		_spawned.erase(key)

func _is_placed(set_id: String, star: int) -> bool:
	for e in placed(set_id):
		if e is Dictionary and int((e as Dictionary).get("star", 0)) == star:
			return true
	return false

# --- super dragon balls (deep space) --------------------------------------

func _tick_super(set_id: String) -> void:
	var p: Node = Game.player
	if p == null or not is_instance_valid(p) or not (p is Node3D):
		return
	var travel: Node = world.get_node_or_null("SpaceTravel") if world != null else null
	if travel == null or not travel.has_method("body_markers"):
		return
	var origin: Vector3 = (p as Node3D).global_position
	var have: Array = found(set_id)
	for m in travel.call("body_markers"):
		if not (m is Dictionary):
			continue
		var d: Dictionary = m
		if String(d.get("kind", "")) != "dragon_ball":
			continue
		var target := String(d.get("target", ""))
		var star := int(target.get_slice("_", target.get_slice_count("_") - 1))
		if star <= 0 or have.has(star):
			continue
		var pos: Vector3 = d.get("position", Vector3.ZERO)
		if origin.distance_to(pos) <= SUPER_PICK_DIST:
			Events.dragon_ball_found.emit(set_id, star)
	if has_all(set_id) and dragon == null and not is_scattered(set_id):
		Events.hint.emit("The Super Dragon Balls answer — speak your wish!", 4.0)
		summon(set_id, origin + Vector3(0, 0, -30.0))

# --- placing / the ritual --------------------------------------------------

## The player used a dragon ball item: put it on the ground in front of them.
func place_ball(player: Node, stack: Object) -> bool:
	if player == null or not is_instance_valid(player) or stack == null:
		return false
	var item := String(stack.get("item"))
	var def: Dictionary = Registry.item(item) if Registry != null else {}
	var ball: Dictionary = def.get("dragon_ball", {})
	var set_id := String(ball.get("set", ""))
	var star := int(ball.get("star", 0))
	if set_id == "" or star <= 0:
		return false
	var pos := _place_position(player)
	var st := set_state(set_id)
	var list: Array = st.get("placed", [])
	for e in list:
		if e is Dictionary and int((e as Dictionary).get("star", 0)) == star:
			return false                # that star is already on the ground
	if not _consume(player, item):
		return false
	list.append({"star": star, "x": pos.x, "y": pos.y, "z": pos.z})
	var node := _spawn_placed(set_id, star, pos)
	if node != null:
		_spawned["%s:%d" % [set_id, star]] = int(node.get_instance_id())
	if Audio != null:
		Audio.play_sfx_at("dragonballssound", pos, -4.0)
	Events.hint.emit("%d★ ball placed (%d/%d)" % [star, list.size(), BALL_COUNT], 2.0)
	_check_ritual(set_id)
	return true

func _place_position(player: Node) -> Vector3:
	var origin: Vector3 = (player as Node3D).global_position if player is Node3D else Vector3.ZERO
	var fwd := Vector3.FORWARD
	if player.has_method("aim_direction"):
		fwd = player.call("aim_direction")
	elif "yaw" in player:
		var y := float(player.get("yaw"))
		fwd = Vector3(-sin(y), 0.0, -cos(y))
	fwd.y = 0.0
	if fwd.length() < 0.01:
		fwd = Vector3.FORWARD
	var target := origin + fwd.normalized() * PLACE_DIST
	var altar := _altar_near(target)
	if altar != Vector3.INF:
		return altar
	if world != null and world.has_method("get_height"):
		var h := int(world.call("get_height", int(floor(target.x)), int(floor(target.z))))
		if h > 0:
			target.y = float(h) + 0.25
	return Vector3(floor(target.x) + 0.5, target.y, floor(target.z) + 0.5)

## Snap onto the top of a `dragon_ball_altar` block within 3 blocks of `near`.
func _altar_near(near: Vector3) -> Vector3:
	if world == null or not world.has_method("get_block") or Registry == null:
		return Vector3.INF
	var altar_id := Registry.block_id(ALTAR_BLOCK)
	if altar_id < 0:
		return Vector3.INF
	var cx := int(floor(near.x))
	var cy := int(floor(near.y))
	var cz := int(floor(near.z))
	for dy in range(-2, 3):
		for dz in range(-3, 4):
			for dx in range(-3, 4):
				if int(world.call("get_block", cx + dx, cy + dy, cz + dz)) == altar_id:
					return Vector3(float(cx + dx) + 0.5, float(cy + dy) + 1.05, float(cz + dz) + 0.5)
	return Vector3.INF

func _consume(player: Node, item: String) -> bool:
	var inv: Variant = player.get("inventory") if "inventory" in player else null
	if inv == null or not is_instance_valid(inv as Object):
		return true
	if (inv as Object).has_method("remove"):
		return int((inv as Object).call("remove", item, 1)) > 0
	return true

func _spawn_placed(set_id: String, star: int, pos: Vector3) -> Node:
	var item := ball_item(set_id, star)
	if item == "" or world == null or not world.has_method("spawn_entity"):
		return null
	var node: Variant = world.call("spawn_entity", "dragon_ball", pos, {"item": item, "count": 1})
	if not (node is Node):
		return null
	var n: Node = node
	if "magnet" in n:
		n.set("magnet", false)
	if "pickup_delay" in n:
		n.set("pickup_delay", PLACE_PICKUP_DELAY)
	if "life" in n:
		n.set("life", 100000.0)
	return n

## Interacting with a `dragon_ball_altar`: lay every ball the player carries on it and
## summon when the set is complete. Returns true when something happened.
func altar_interact(player: Node, block_pos: Vector3i) -> bool:
	if player == null or not is_instance_valid(player) or not ("inventory" in player):
		return false
	var inv: Variant = player.get("inventory")
	if inv == null or not is_instance_valid(inv as Object):
		return false
	var center := Vector3(float(block_pos.x) + 0.5, float(block_pos.y) + 1.05, float(block_pos.z) + 0.5)
	var placed_any := false
	for set_id in ["earth", "namek", "cereal", "super", "fused"]:
		var st := set_state(set_id)
		var list: Array = st.get("placed", [])
		for star in range(1, BALL_COUNT + 1):
			var item := ball_item(set_id, star)
			if item == "" or not bool((inv as Object).call("has", item, 1)):
				continue
			if _is_placed(set_id, star):
				continue
			(inv as Object).call("remove", item, 1)
			var angle := TAU * float(star - 1) / float(BALL_COUNT)
			var pos := center + Vector3(cos(angle) * 1.2, 0.0, sin(angle) * 1.2)
			list.append({"star": star, "x": pos.x, "y": pos.y, "z": pos.z})
			var node := _spawn_placed(set_id, star, pos)
			if node != null:
				_spawned["%s:%d" % [set_id, star]] = int(node.get_instance_id())
			placed_any = true
		if placed_any:
			if Audio != null:
				Audio.play_sfx_at("dragonballssound", center, -2.0)
			_check_ritual(set_id)
			return true
	return false

## 7 distinct stars of one set within RITUAL_RADIUS summon the dragon.
func _check_ritual(set_id: String) -> void:
	var list: Array = placed(set_id)
	if list.size() < BALL_COUNT:
		return
	for anchor in list:
		if not (anchor is Dictionary):
			continue
		var a: Vector3 = _entry_pos(anchor)
		var stars: Array = []
		var sum := Vector3.ZERO
		for e in list:
			if not (e is Dictionary):
				continue
			var p := _entry_pos(e)
			if p.distance_to(a) > RITUAL_RADIUS:
				continue
			var star := int((e as Dictionary).get("star", 0))
			if stars.has(star):
				continue
			stars.append(star)
			sum += p
		if stars.size() >= BALL_COUNT:
			summon(set_id, sum / float(stars.size()))
			return

func _entry_pos(entry: Variant) -> Vector3:
	if entry is Dictionary:
		var d: Dictionary = entry
		return Vector3(float(d.get("x", 0.0)), float(d.get("y", 0.0)), float(d.get("z", 0.0)))
	return Vector3.ZERO

# --- summoning -------------------------------------------------------------

## Summon the set's dragon at `pos`. Returns false when the planet is wrong.
func summon(set_id: String, pos: Vector3) -> bool:
	if dragon != null and is_instance_valid(dragon):
		return false
	var did := dragon_for_set(set_id)
	if did == "":
		return false
	var def: Dictionary = Registry.wishes.get(did, {}) if Registry != null else {}
	var planets: Array = def.get("summon_planets", [])
	if not planets.is_empty() and not planets.has(planet_id()):
		Events.hint.emit("%s cannot be summoned here." % String(def.get("name", did.capitalize())), 3.0)
		return false
	current_dragon = did
	summon_origin = pos
	wishes_left = maxi(1, int(def.get("wish_count", 1)))
	_darken(true)
	if Audio != null:
		Audio.play_sfx("shenron", 1.0)
		Audio.play_sfx_at("dragonballssound", pos, -2.0)
	Events.screen_shake.emit(0.6, 2.5)
	var entity_id := String(def.get("entity", did))
	if world != null and world.has_method("spawn_entity") and Registry != null and Registry.entities.has(entity_id):
		var node: Variant = world.call("spawn_entity", entity_id, pos, {"dragon_id": did})
		if node is Node:
			dragon = node
	if dragon == null or not ("dragon_id" in dragon):
		Events.dragon_summoned.emit(did)
	_toast("%s rises" % String(def.get("name", did.capitalize())),
		"You may make %d wish(es)." % wishes_left)
	_open_wish_screen()
	return true

func _open_wish_screen() -> void:
	if Game == null or Game.ui == null:
		return
	Game.ui.call("open", "wish", {"dragon": current_dragon, "callback": Callable(self, "on_wish_chosen")})

## WishScreen callback (it also emits Events.wish_granted and closes itself).
func on_wish_chosen(dragon_id: String, wish_id: String) -> void:
	grant_wish(dragon_id, wish_id)
	wishes_left -= 1
	if wishes_left > 0:
		Events.hint.emit("%d wish(es) left." % wishes_left, 3.0)
		get_tree().create_timer(0.8).timeout.connect(_open_wish_screen, CONNECT_ONE_SHOT)
		return
	finish_summon()

## Apply one wish from wishes.json. Returns false for an unknown wish.
func grant_wish(dragon_id: String, wish_id: String) -> bool:
	var def: Dictionary = Registry.wishes.get(dragon_id, {}) if Registry != null else {}
	var wish: Dictionary = {}
	for w in def.get("wishes", []):
		if w is Dictionary and String((w as Dictionary).get("id", "")) == wish_id:
			wish = w
			break
	if wish.is_empty():
		return false
	var profile: Dictionary = Game.profile if Game != null else {}
	var player: Node = Game.player if Game != null else null
	match String(wish.get("type", "")):
		"item":
			for it in wish.get("items", []):
				if not (it is Dictionary):
					continue
				Rewards.apply({"type": "ITEM", "item": String((it as Dictionary).get("item", "")),
					"count": int((it as Dictionary).get("count", 1))}, profile, player)
		"tps":
			Rewards.apply({"type": "TPS", "amount": int(wish.get("amount", 0))}, profile, player)
		"form":
			Rewards.apply({"type": "FORM", "form": String(wish.get("form", ""))}, profile, player)
		"planet":
			Rewards.apply({"type": "UNLOCK_PLANET", "planet": String(wish.get("planet", ""))}, profile, player)
		"reset":
			_apply_reset(String(wish.get("reset", "")), profile, player)
		"recustomize":
			StoryFlags.set_flag("recustomize_pending", true)
			if Game != null and Game.ui != null:
				Game.ui.call("open", "character_creation", {"recustomize": true})
		"revive":
			_apply_revive(profile, player)
	StoryFlags.inc("wishes_granted")
	StoryFlags.set_flag("last_wish", wish_id)
	Log.i("DragonBalls: %s granted wish %s" % [dragon_id, wish_id])
	return true

func _apply_reset(kind: String, profile: Dictionary, player: Node) -> void:
	match kind:
		"racial_passive":
			var skills: Dictionary = profile.get("skills", {})
			for key in ["racial_passive", "zenkai", "regeneration", "majin_magic"]:
				if skills.has(key):
					skills[key] = 0
			StoryFlags.set_flag("racial_passive_reset", true)
		"stats":
			var race: Dictionary = Registry.race(String(profile.get("character", {}).get("race", "human"))) if Registry != null else {}
			var base: Dictionary = race.get("base_stats", {})
			var stats: Dictionary = profile.get("stats", {})
			for k in stats.keys():
				stats[k] = int(base.get(k, 5))
			profile["stats"] = stats
			profile["tp"] = int(profile.get("tp_total", profile.get("tp", 0)))
			if player != null and is_instance_valid(player) and "stats" in player:
				var s: Variant = player.get("stats")
				if s != null and (s as Object).has_method("from_profile"):
					(s as Object).call("from_profile", profile)
				if player.has_method("refresh_derived"):
					player.call("refresh_derived")
			Events.stats_changed.emit()
			Events.tp_changed.emit(int(profile.get("tp", 0)), int(profile.get("tp_total", 0)))

func _apply_revive(profile: Dictionary, player: Node) -> void:
	if player != null and is_instance_valid(player):
		if player.has_method("heal"):
			player.call("heal", 99999.0)
		if player is Node3D and player.has_method("set_spawn"):
			player.call("set_spawn", (player as Node3D).global_position, planet_id())
	profile["health"] = -1
	var pos: Vector3 = (player as Node3D).global_position if player is Node3D else Vector3.ZERO
	profile["spawn"] = {"planet": planet_id(), "x": pos.x, "y": pos.y, "z": pos.z}

## Dismiss the dragon, restore the sky and scatter the balls for one in-game week.
func finish_summon() -> void:
	var set_id := String(Registry.wishes.get(current_dragon, {}).get("ball_set", "")) if Registry != null else ""
	if set_id == "":
		set_id = set_for_planet()
	_darken(false)
	if dragon != null and is_instance_valid(dragon):
		if dragon.has_method("dismiss"):
			dragon.call("dismiss")
		else:
			dragon.queue_free()
	dragon = null
	if set_id != "":
		scatter(set_id)
	current_dragon = ""
	wishes_left = 0
	if Audio != null:
		Audio.play_bgm("explore")

## Clear the set, pick new positions and hide the balls for SCATTER_DAYS in-game days.
func scatter(set_id: String) -> void:
	var st := set_state(set_id)
	_clear_spawned(set_id)
	st["placed"] = []
	st["found"] = []
	st["scatter"] = int(st.get("scatter", 0)) + 1
	st["summons"] = int(st.get("summons", 0)) + 1
	st["next_summon_day"] = StoryFlags.day_index() + SCATTER_DAYS
	_strip_inventory(set_id)
	_toast("The dragon balls scatter", "They turn to stone for %d days." % SCATTER_DAYS)

## Remove the set's ball items from the player inventory (they scattered).
func _strip_inventory(set_id: String) -> void:
	var p: Node = Game.player if Game != null else null
	var inv: Variant = p.get("inventory") if p != null and is_instance_valid(p) and "inventory" in p else null
	for star in range(1, BALL_COUNT + 1):
		var item := ball_item(set_id, star)
		if item == "":
			continue
		if inv != null and is_instance_valid(inv as Object) and (inv as Object).has_method("remove"):
			(inv as Object).call("remove", item, 99)
		_strip_profile_item(item)

func _strip_profile_item(item: String) -> void:
	if Game == null or Game.profile.is_empty():
		return
	var slots: Variant = Game.profile.get("inventory", {}).get("slots", null)
	if not (slots is Array):
		return
	var arr: Array = slots
	for i in arr.size():
		var s: Variant = arr[i]
		if s is Dictionary and String((s as Dictionary).get("item", "")) == item:
			arr[i] = null

func _darken(on: bool) -> void:
	if world == null:
		return
	var sky: Node = world.get_node_or_null("SkyController")
	if sky != null and sky.has_method("override_darkness"):
		sky.call("override_darkness", 0.88 if on else 0.0)
		_darkened = on
		return
	Events.screen_flash.emit(Color(0.02, 0.02, 0.05, 0.75 if on else 0.0), 1.5)
	_darkened = on

# --- pickup bookkeeping ----------------------------------------------------

func _on_ball_found(set_id: String, star: int) -> void:
	var st := set_state(set_id)
	var have: Array = st.get("found", [])
	if have.has(star):
		return
	have.append(star)
	have.sort()
	var list: Array = st.get("placed", [])
	for i in range(list.size() - 1, -1, -1):
		if list[i] is Dictionary and int((list[i] as Dictionary).get("star", 0)) == star:
			list.remove_at(i)
	_spawned.erase("%s:%d" % [set_id, star])
	if Audio != null:
		Audio.play_sfx("dball_pickup", -2.0)
	_toast("Dragon Ball found", "%d★ — %d/%d collected" % [star, have.size(), BALL_COUNT])
	if have.size() >= BALL_COUNT:
		Events.hint.emit("All seven! Place them together (or on an altar) to summon.", 6.0)

func _on_item_picked_up(item_id: String, _count: int) -> void:
	var def: Dictionary = Registry.item(item_id) if Registry != null else {}
	if String(def.get("kind", "")) != "dragon_ball":
		return
	var ball: Dictionary = def.get("dragon_ball", {})
	_on_ball_found(String(ball.get("set", "earth")), int(ball.get("star", 1)))

func _toast(title: String, text: String) -> void:
	if Game != null and Game.ui != null and Game.ui.has_method("toast"):
		Game.ui.call("toast", title, text, null)
	else:
		Events.toast.emit(title, text, null)
