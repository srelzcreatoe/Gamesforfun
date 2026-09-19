// ambient_birds.gdshader - a V-formation flock crossing the sky (scripts/ambient/AmbientFlock.gd).
//
// One MultiMesh per flock: the instance transforms hold only the formation offsets (x right,
// y up, z back along the heading), and the flock's motion, the two-frame wing flap, the bob and
// the fade-in/out at the ends of the pass are all computed here from TIME. The CPU touches a
// flock only when it re-seeds it (a new heading, every ~40 s), so birds are free.
//
// Per-instance data:
//   INSTANCE_CUSTOM.x  seed 0..1  (flap and bob phase)
//
// Original work for Dragon Block Sagas. Sprites: Fused vanilla pack (4 frames of 16x16).

shader_type spatial;
render_mode blend_mix, unshaded, cull_disabled, shadows_disabled, fog_disabled;

uniform sampler2D sprite : source_color, filter_nearest, repeat_disable;
uniform vec3 origin = vec3(0.0, 80.0, 0.0);
uniform vec3 heading = vec3(1.0, 0.0, 0.0);
uniform float span = 260.0;
uniform float period = 52.0;
uniform float phase : hint_range(0.0, 1.0) = 0.0;
uniform float size = 0.9;
uniform float flap_speed : hint_range(0.5, 20.0) = 4.5;
uniform vec4 tint : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float frames = 4.0;
uniform float master_alpha : hint_range(0.0, 1.0) = 1.0;

varying vec4 col;
varying vec2 uvf;

void vertex() {
	float seed = INSTANCE_CUSTOM.x;
	vec3 slot = MODEL_MATRIX[3].xyz;

	float u = fract(TIME / max(period, 1.0) + phase);
	vec3 dir = normalize(heading);
	vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), dir) + vec3(0.0, 0.0, 0.0001));
	float bob = sin(TIME * 1.3 + seed * 6.2831853) * 0.45;
	vec3 wpos = origin + dir * ((u - 0.5) * span) + right * slot.x
		+ vec3(0.0, slot.y + bob, 0.0) - dir * slot.z;

	float edge = smoothstep(0.0, 0.10, u) * (1.0 - smoothstep(0.90, 1.0, u));

	vec3 to_cam = CAMERA_POSITION_WORLD - wpos;
	float dist = length(to_cam);
	vec3 fwd = to_cam / max(dist, 0.0001);
	vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), fwd) + vec3(0.0001, 0.0, 0.0));
	vec3 upv = cross(fwd, r);

	col = vec4(tint.rgb, tint.a * edge * master_alpha);
	// Two-frame flap: sprite frames 0 and 2 of the 4-frame sheet.
	float f = step(0.0, sin(TIME * flap_speed + seed * 6.2831853)) * 2.0;
	uvf = vec2((clamp(UV.x, 0.02, 0.98) + f) / frames, UV.y);

	vec3 v = wpos + r * VERTEX.x * size + upv * VERTEX.y * size;
	POSITION = PROJECTION_MATRIX * VIEW_MATRIX * vec4(v, 1.0);
}

void fragment() {
	vec4 t = texture(sprite, uvf);
	if (t.a < 0.35 || col.a < 0.02) {
		discard;
	}
	ALBEDO = t.rgb * col.rgb;
	ALPHA = t.a * col.a;
}
