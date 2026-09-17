// ambient_butterfly.gdshader - two-quad flapping butterflies (scripts/ambient/AmbientFlyers.gd).
//
// The mesh is two wing quads hinged at x = 0 lying flat in XZ with the body along Z (built by
// AmbientAssets.butterfly_mesh). This shader folds the wings up and down around the body axis,
// walks each butterfly along its own lissajous flight path and turns it to face the way it is
// going, so a whole meadow of butterflies is one MultiMesh draw call and zero CPU per frame.
//
// Per-instance data:
//   INSTANCE_CUSTOM.x  seed 0..1        (phase)
//   INSTANCE_CUSTOM.y  flight radius m
//   INSTANCE_CUSTOM.z  speed multiplier
//   INSTANCE_CUSTOM.w  scale multiplier
//
// Original work for Dragon Block Sagas.

shader_type spatial;
render_mode blend_mix, unshaded, cull_disabled, shadows_disabled, fog_disabled;

uniform sampler2D sprite : source_color, filter_nearest, repeat_disable;
uniform float size = 0.22;
uniform float flap_speed : hint_range(1.0, 40.0) = 15.0;
uniform float flap_amount : hint_range(0.0, 1.6) = 1.1;
uniform float move_speed : hint_range(0.0, 3.0) = 0.42;
uniform vec3 light_tint : source_color = vec3(1.0, 1.0, 1.0);
uniform float fade_start = 16.0;
uniform float fade_end = 26.0;
uniform float master_alpha : hint_range(0.0, 1.0) = 1.0;

varying float vfade;

vec3 rot_y(vec3 p, float a) {
	float c = cos(a);
	float s = sin(a);
	return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}

vec3 path(float t, float radius) {
	return vec3(sin(t * 0.53), sin(t * 1.27 + 1.3) * 0.26, cos(t * 0.37 + 0.7)) * radius;
}

void vertex() {
	float seed = INSTANCE_CUSTOM.x;
	float radius = max(INSTANCE_CUSTOM.y, 0.05);
	float spd = max(INSTANCE_CUSTOM.z, 0.05);
	float scl = max(INSTANCE_CUSTOM.w, 0.05);

	vec3 home = MODEL_MATRIX[3].xyz;
	float t = TIME * move_speed * spd + seed * 71.0;
	vec3 p0 = path(t, radius);
	vec3 vel = path(t + 0.15, radius) - p0;
	float yaw = atan(vel.x, vel.z);

	// Wings fold together about the body axis: |x| lifts, x shrinks.
	float flap = sin(TIME * flap_speed * spd + seed * 6.2831853) * flap_amount;
	vec3 lv = VERTEX * size * scl;
	vec3 local = vec3(lv.x * cos(flap), abs(lv.x) * sin(flap), lv.z);
	vec3 wpos = home + p0 + rot_y(local, yaw);

	float dist = distance(wpos, CAMERA_POSITION_WORLD);
	vfade = (1.0 - smoothstep(fade_start, fade_end, dist)) * master_alpha;
	POSITION = PROJECTION_MATRIX * VIEW_MATRIX * vec4(wpos, 1.0);
}

void fragment() {
	vec4 t = texture(sprite, UV);
	if (t.a < 0.4 || vfade < 0.02) {
		discard;
	}
	ALBEDO = t.rgb * light_tint;
	ALPHA = t.a * vfade;
}
