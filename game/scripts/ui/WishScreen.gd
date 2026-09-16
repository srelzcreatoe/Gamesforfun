class_name WishScreen
extends ScreenBase
## The dragon's wish list (Registry.wishes[dragon]); calls back into whoever summoned the dragon.
## open("wish", {dragon: "shenron", callback: Callable})

var dragon := "shenron"
var callback: Callable = Callable()

func _init() -> void:
	screen_name = "wish"

func build() -> void:
	dragon = String(args.get("dragon", "shenron"))
	var cb: Variant = args.get("callback", null)
	if cb is Callable:
		callback = cb
	var def: Dictionary = Registry.wishes.get(dragon, {}) if Registry != null else {}
	var body := page("%s awaits" % String(def.get("name", dragon.capitalize())))
	body.add_child(UiUtil.dim("Speak your wish. You may make %d." % int(def.get("wish_count", 1)), UiUtil.font_small(s)))
	var list := UiUtil.vbox(6.0 * s)
	var sc := UiUtil.scroll(list)
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(sc)
	var wishes: Array = def.get("wishes", [])
	if wishes.is_empty():
		list.add_child(UiUtil.dim("The dragon is silent (no wish data).", UiUtil.font_small(s)))
		return
	for w in wishes:
		list.add_child(_row(w))

func _row(w: Dictionary) -> Control:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UiUtil.panel_light())
	var row := UiUtil.hbox(8.0 * s)
	var icon: Texture2D = UiUtil.gui_tex("quest/reward_generic")
	var items: Array = w.get("items", [])
	if items.size() > 0:
		icon = UiUtil.item_icon(String(items[0].get("item", "")))
	row.add_child(UiUtil.icon_rect(icon, Vector2(34.0 * s, 34.0 * s)))
	var col := UiUtil.vbox(1.0 * s)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_child(UiUtil.label(String(w.get("name", "Wish")), UiUtil.font_small(s), Color(1.0, 0.92, 0.6)))
	var d := UiUtil.dim(String(w.get("desc", "")), UiUtil.font_small(s))
	d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(d)
	row.add_child(col)
	var wid := String(w.get("id", ""))
	row.add_child(UiUtil.flat_button("Wish", func() -> void: _grant(wid, w), false, 110.0 * s))
	p.add_child(row)
	return p

func _grant(wish_id: String, w: Dictionary) -> void:
	if callback.is_valid():
		callback.call(dragon, wish_id)
	else:
		_apply_locally(w)
	Events.wish_granted.emit(dragon, wish_id)
	Audio.play_sfx("wish_granted", -3.0)
	Game.ui.call("toast", "Wish granted", String(w.get("name", "")), null)
	close_self()

func _apply_locally(w: Dictionary) -> void:
	match String(w.get("type", "")):
		"item":
			for it in w.get("items", []):
				if Game.player != null and Game.player.has_method("give"):
					Game.player.call("give", String(it.get("item", "")), int(it.get("count", 1)))
		"tps":
			if Game.player != null and Game.player.get("stats") != null:
				var st: Variant = Game.player.get("stats")
				if st.has_method("add_tp"):
					st.call("add_tp", int(w.get("amount", 0)))
