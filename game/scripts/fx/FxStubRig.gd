class_name FxStubRig
extends Node3D
## Camera-rig stand-in for the fx preview stage (`--staticcam`): it answers the
## `cinematic_orbit` / `shake` / `cancel_cinematic` calls the transformation director
## makes on `Game.player.camera_rig` and does nothing, so the verification camera stays
## exactly where the shot needs it. Never used by the game itself.

var last_center := Vector3.ZERO
var last_duration := 0.0
var orbits := 0
var shakes := 0

func cinematic_orbit(center: Vector3, duration: float, _dist_from := 6.0, _dist_to := 3.0) -> void:
	last_center = center
	last_duration = duration
	orbits += 1

func cancel_cinematic() -> void:
	pass

func is_cinematic() -> bool:
	return false

func shake(_strength: float, _duration: float) -> void:
	shakes += 1
