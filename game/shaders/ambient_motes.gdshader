// ambient_motes.gdshader - the drifting-specks field (scripts/ambient/AmbientMotes.gd).
//
// One MultiMeshInstance3D draws every firefly / pollen grain / dust mote / snow sparkle in the
// scene as a single draw call. The CPU only writes an instance transform when a mote has to be
// re-homed (it left the spawn ring); the wander, the vertical loop, the firefly blink and the
// camera billboard all live here, so the field costs nothing per frame on the main thread.
//
// Per-instance data:
//   INSTANCE_CUSTOM.x  seed 0..1        (phase of everything)
//   INSTANCE_CUSTOM.y  wander radius m  (how far it strays from its home)
//   INSTANCE_CUSTOM.z  rise rate 1/s    (0 = hovers, >0 = loops upward and fades at both ends)
//   INSTANCE_CUSTOM.w  blink rate rad/s (0 = steady glow, >0 = firefly pulse)
//   COLOR              per-instance colour and base alpha
//
// Original work for Dragon Block Sagas.

shader_type spatial;
render_mode blend_add, unshaded, cull_disabled, depth_draw_never, shadows_disabled, fog_disabled;

uniform sampler2D sprite : source_color, filter_linear, repeat_disable;
uniform vec3 tint : source_color = vec3(1.0, 1.0, 1.0);
uniform float size = 0.10;
uniform float glow : hint_range(0.0, 4.0) = 1.0;
uniform float wander : hint_range(0.0, 4.0) = 0.6;
uniform float fade_near = 0.8;
uniform float fade_start = 20.0;
uniform float fade_end = 34.0;
uniform float master_alpha : hint_range(0.0, 1.0) = 1.0;

varying vec4 col;

void vertex() {
	float seed = INSTANCE_CUSTOM.x;
	float radius = INSTANCE_CUSTOM.y;
	float rise = INSTANCE_CUSTOM.z;
	float blink = INSTANCE_CUSTOM.w;

	vec3 home = MODEL_MATRIX[3].xyz;
	float t = TIME * wander + seed * 61.0;
	vec3 off = vec3(sin(t * 0.83), sin(t * 0.47 + 1.7) * 0.5, cos(t * 0.61 + 2.3)) * radius;

	// Rising motes loop through a column `3 * radius` tall and fade in and out at the ends so
	// the wrap is invisible. rise == 0 means "just hover", with no life fade at all.
	float loop_on = step(0.0001, abs(rise));
	float cy = fract(seed * 7.13 + TIME * rise);
	off.y += mix(0.0, (cy - 0.5) * radius * 3.0, loop_on);
	float life = smoothstep(0.0, 0.14, cy) * (1.0 - smoothstep(0.82, 1.0, cy));
	life = mix(1.0, life, loop_on);

	// Fireflies: long dark gaps, short bright flashes (sin cubed, clipped to the positive half).
	float pulse = 1.0;
	if (blink > 0.0) {
		float s = max(0.0, sin(TIME * blink + seed * 6.2831853));
		pulse = 0.06 + 0.94 * s * s * s;
	}

	vec3 wpos = home + off;
	vec3 to_cam = CAMERA_POSITION_WORLD - wpos;
	float dist = length(to_cam);
	vec3 fwd = to_cam / max(dist, 0.0001);
	vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd) + vec3(0.0001, 0.0, 0.0));
	vec3 up = cross(fwd, right);

	float fade = (1.0 - smoothstep(fade_start, fade_end, dist)) * smoothstep(0.0, fade_near, dist);
	col = vec4(COLOR.rgb * tint * glow, COLOR.a * life * pulse * fade * master_alpha);

	float s2 = size * (0.65 + 0.7 * fract(seed * 3.77));
	vec3 v = wpos + right * VERTEX.x * s2 + up * VERTEX.y * s2;
	POSITION = PROJECTION_MATRIX * VIEW_MATRIX * vec4(v, 1.0);
}

void fragment() {
	vec4 t = texture(sprite, UV);
	ALBEDO = t.rgb * col.rgb;
	ALPHA = t.a * col.a;
}
