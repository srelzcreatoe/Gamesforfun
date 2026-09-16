class_name SpaceMap
extends ScreenBase
## Planet select for space travel: icons, lock state and Game.change_planet.

const ICON_SHEET := "spaceshipicons"

func _init() -> void:
	screen_name = "space_map"

func build() -> void:
	var body := page("Navigation")
	body.add_child(UiUtil.dim("Choose a destination.", UiUtil.font_small(s)))
	var grid := GridContainer.new()
	grid.columns = maxi(2, int(size.x / (190.0 * s)))
	grid.add_theme_constant_override("h_separation", int(10.0 * s))
	grid.add_theme_constant_override("v_separation", int(10.0 * s))
	var sc := UiUtil.scroll(grid)
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(sc)
	var unlocked: Array = Game.profile.get("planets_unlocked", ["earth"]) if Game != null else ["earth"]
	var planets: Dictionary = Registry.planets if Registry != null else {}
	if planets.is_empty():
		grid.add_child(UiUtil.dim("No planet data yet.", UiUtil.font_small(s)))
		return
	var i := 0
	for pid in planets.keys():
		var def: Dictionary = planets[pid]
		grid.add_child(_card(String(pid), def, unlocked.has(String(pid)), i))
		i += 1

func _card(pid: String, def: Dictionary, unlocked: bool, index: int) -> Control:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UiUtil.panel_light())
	p.custom_minimum_size = Vector2(170.0 * s, 150.0 * s)
	var v := UiUtil.vbox(4.0 * s)
	var icon := UiUtil.icon_rect(_planet_icon(pid, def), Vector2(72.0 * s, 72.0 * s))
	icon.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	if not unlocked:
		icon.modulate = Color(0.4, 0.4, 0.45)
	v.add_child(icon)
	var nm := UiUtil.label(String(def.get("name", pid.capitalize())), UiUtil.font_small(s),
		Color.WHITE if unlocked else UiUtil.DIM_COLOR, HORIZONTAL_ALIGNMENT_CENTER)
	nm.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	nm.custom_minimum_size.x = 120.0 * s
	v.add_child(nm)
	v.add_child(UiUtil.dim("gravity x%.2f%s" % [float(def.get("gravity", 1.0)),
		"" if bool(def.get("oxygen", true)) else "  no air"], UiUtil.font_small(s)))
	var here := Game != null and String(Game.world_info.get("planet", "")) == pid
	if here:
		v.add_child(UiUtil.label("You are here", UiUtil.font_small(s), Color(0.6, 0.9, 0.6), HORIZONTAL_ALIGNMENT_CENTER))
	elif unlocked:
		v.add_child(UiUtil.flat_button("Travel", func() -> void: _travel(pid), false, 120.0 * s))
	else:
		v.add_child(UiUtil.dim("locked", UiUtil.font_small(s)))
	p.add_child(v)
	return p

## Planet portraits come from assets/textures/environment/<planet>.png when the pipeline has one,
## otherwise a disc tinted with the planet's own sky colour.
static var _disc_cache: Dictionary = {}

func _planet_icon(pid: String, def: Dictionary) -> Texture2D:
	for name in [pid, pid + "_planet", pid.replace("planet_", "")]:
		var path := "res://assets/textures/environment/%s.png" % name
		if ResourceLoader.exists(path):
			return load(path)
	return _disc(UiUtil.color_hex(String(def.get("sky", {}).get("day", "#6C7BA8")), Color(0.42, 0.48, 0.66)))

static func _disc(col: Color) -> Texture2D:
	var key := col.to_html()
	if _disc_cache.has(key):
		return _disc_cache[key]
	var n := 32
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	var c := Vector2(float(n) * 0.5, float(n) * 0.5)
	for y in n:
		for x in n:
			var d := Vector2(float(x) + 0.5, float(y) + 0.5).distance_to(c) / (float(n) * 0.5)
			if d > 1.0:
				img.set_pixel(x, y, Color(0, 0, 0, 0))
				continue
			var shade := clampf(1.15 - d * 0.75, 0.25, 1.15)
			var speck := 1.0 + (0.12 if ((x * 7 + y * 13) % 11 == 0) else 0.0)
			img.set_pixel(x, y, Color(col.r * shade * speck, col.g * shade * speck, col.b * shade * speck, 1.0))
	var t := ImageTexture.create_from_image(img)
	_disc_cache[key] = t
	return t

func _travel(pid: String) -> void:
	Events.travel_requested.emit(pid)
	var st: Node = null
	if Game.world != null:
		st = Game.world.get_node_or_null("SpaceTravel")
	close_self()
	if st != null and st.has_method("travel_to"):
		st.call("travel_to", pid)
	else:
		Game.change_planet(pid)
