class_name AmbientShimmer
extends CanvasLayer
## Heat shimmer over Vampa and Hell (and a whisper of it over deserts).
##
## A full-rect ColorRect on canvas layer 1 — below the fx agent's post-process pass (layer 3) and
## far below the HUD (layer 10) — running ambient_shimmer.gdshader, which bends the lower part of
## the screen and warms it. The layer is hidden outright when `strength` is 0, so nothing is
## drawn and no screen copy happens on planets that do not shimmer.

const CANVAS_LAYER := 1

var rect: ColorRect = null
var strength := 0.0

var _mat: ShaderMaterial = null

func setup() -> void:
	name = "AmbientShimmer"
	layer = CANVAS_LAYER
	rect = ColorRect.new()
	rect.name = "Shimmer"
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rect.color = Color(1, 1, 1, 1)
	_mat = AmbientAssets.shader_material("res://shaders/ambient_shimmer.gdshader")
	rect.material = _mat
	add_child(rect)
	visible = false

## 0 disables the pass entirely (the CanvasLayer is hidden, so no screen copy is taken).
func set_strength(s: float) -> void:
	strength = clampf(s, 0.0, 1.0)
	visible = strength > 0.01 and _mat != null and _mat.shader != null
	if _mat != null:
		_mat.set_shader_parameter("strength", strength)

func set_haze(color: Color, amount: float) -> void:
	if _mat != null:
		_mat.set_shader_parameter("haze", Vector3(color.r, color.g, color.b))
		_mat.set_shader_parameter("haze_amount", clampf(amount, 0.0, 0.4))

func is_running() -> bool:
	return visible and strength > 0.01
