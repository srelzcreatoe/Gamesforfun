class_name DeathScreen
extends ScreenBase
## "You were defeated..." -> respawn at the spawn point (the last master / Kame House).

func _init() -> void:
	screen_name = "death"

func build() -> void:
	var cr := UiUtil.dim_background(self, 0.55)
	cr.color = Color(0.35, 0.02, 0.02, 0.55)
	var v := UiUtil.vbox(12.0 * s)
	v.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	add_child(v)
	content = v
	var title := UiUtil.title_glow("YOU WERE DEFEATED", Color(1.0, 0.25, 0.3), Color(1.0, 0.85, 0.85))
	title.custom_minimum_size.x = size.x
	v.add_child(title)
	var killer: Variant = args.get("killer", null)
	var who := ""
	if killer != null and killer is Node:
		var et := String((killer as Node).get("entity_type"))
		who = String(Registry.entity(et).get("name", et.capitalize())) if Registry != null else et
	if who != "":
		v.add_child(UiUtil.label("Defeated by %s" % who, UiUtil.font_small(s), UiUtil.DIM_COLOR, HORIZONTAL_ALIGNMENT_CENTER))
	var keep := true
	if Game != null:
		keep = bool(Game.world_info.get("keep_inventory", true)) or Game.world_info.get("difficulty", "normal") != "hard"
	v.add_child(UiUtil.label("Your items are safe." if keep else "You dropped everything.",
		UiUtil.font_small(s), UiUtil.DIM_COLOR, HORIZONTAL_ALIGNMENT_CENTER))
	v.add_child(UiUtil.spacer(12.0 * s))
	var bw := minf(320.0 * s, size.x * 0.6)
	var center := HBoxContainer.new()
	center.alignment = BoxContainer.ALIGNMENT_CENTER
	var frame := UiUtil.dmz_panel("big")
	var rows := UiUtil.vbox(8.0 * s)
	frame.add_child(rows)
	rows.add_child(UiUtil.button("Respawn", _respawn, bw, 46.0 * s))
	rows.add_child(UiUtil.button("Save & Quit", func() -> void:
		Game.save_all()
		Game.ui.call("close_all")
		Game.quit_to_menu(), bw, 46.0 * s))
	center.add_child(frame)
	v.add_child(center)

func _respawn() -> void:
	if Game != null and Game.player != null and Game.player.has_method("respawn"):
		Game.player.call("respawn")
	close_self()

func _unhandled_input(event: InputEvent) -> void:
	# BACK must not dismiss the death screen without respawning.
	pass

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_GO_BACK_REQUEST and is_visible_in_tree():
		_respawn()
