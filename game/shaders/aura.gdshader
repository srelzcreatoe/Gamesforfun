shader_type spatial;
render_mode blend_add, unshaded, cull_disabled, depth_draw_never, shadows_disabled, skip_vertex_transform;
// Procedural ki aura: scrolling flame noise in `aura_color` with a hot inner core,
// additive, vertex wobble and a pulse. gl_compatibility safe (no screen texture,
// no derivatives, no depth read). Co-owned with the shaders agent: keep the uniforms.

uniform vec4 aura_color : source_color = vec4(1.0, 0.843, 0.0, 1.0);
uniform vec4 inner_color : source_color = vec4(1.0, 1.0, 0.86, 1.0);
uniform float intensity : hint_range(0.0, 4.0) = 1.0;
uniform float scroll_speed = 2.4;
uniform float noise_scale = 3.5;
uniform float wobble = 0.05;
uniform float wobble_speed = 7.0;
uniform float pulse_speed = 5.5;
uniform float pulse_amount = 0.18;
uniform float flame_sharpness = 1.35;
uniform float rise = 0.55;          // how much the flames stretch upward
uniform float tip_fade = 0.35;      // fade of the top tips
uniform float seed = 0.0;

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = hash12(i);
	float b = hash12(i + vec2(1.0, 0.0));
	float c = hash12(i + vec2(0.0, 1.0));
	float d = hash12(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
	float v = 0.0;
	float amp = 0.55;
	for (int i = 0; i < 4; i++) {
		v += vnoise(p) * amp;
		p *= 2.03;
		amp *= 0.5;
	}
	return v;
}

varying float v_height;
varying vec3 v_local;

void vertex() {
	v_local = VERTEX;
	v_height = clamp(VERTEX.y * 0.55 + 0.3, 0.0, 1.5);
	float w = sin(TIME * wobble_speed + VERTEX.y * 6.0 + seed) * cos(TIME * wobble_speed * 0.7 + VERTEX.x * 5.0);
	vec3 offs = NORMAL * w * wobble * (0.4 + v_height) * intensity;
	VERTEX += offs;
	VERTEX.y += rise * 0.08 * intensity * v_height;
	VERTEX = (MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	NORMAL = normalize((MODELVIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec2 uv = UV;
	float h = clamp(uv.y, 0.0, 1.0);

	// flames travel up the body: scroll the noise down in UV space
	vec2 p = vec2(uv.x * noise_scale * 2.0 + seed, uv.y * noise_scale - TIME * scroll_speed);
	float n = fbm(p);
	float n2 = fbm(p * 2.1 + vec2(11.3, -TIME * scroll_speed * 1.7));
	float flame = clamp(n * 0.65 + n2 * 0.45, 0.0, 1.0);
	flame = pow(flame, flame_sharpness);

	// the noise has to clear a rising threshold, so the shell is dense at the feet
	// and breaks into separate licking tongues towards the top
	float threshold = mix(0.20, 0.62, pow(h, 0.85)) * (1.0 - 0.25 * (intensity - 1.0));
	float body = smoothstep(threshold, threshold + 0.20, flame);
	float core = smoothstep(threshold + 0.16, threshold + 0.44, flame);

	float pulse = 1.0 + sin(TIME * pulse_speed) * pulse_amount;
	// keep the silhouette hot where the mesh faces the camera edge on
	float rim = 1.0 - abs(dot(normalize(NORMAL), normalize(-VERTEX)));

	vec3 col = mix(aura_color.rgb, inner_color.rgb, core);
	// front-facing parts of the shell stay nearly transparent so the body reads
	// through it; the grazing silhouette is where the flames are bright
	// the shell is thin around the feet (so the legs read), fattest around the torso and
	// breaks into tongues towards the top
	float band = smoothstep(0.0, 0.30, h) * (1.0 - 0.45 * smoothstep(0.55, 1.0, h));
	float a = body * (0.16 + 0.34 * band) * (0.08 + 1.55 * rim) * clamp(intensity, 0.0, 2.0) * pulse;

	ALBEDO = col * (0.85 + 0.9 * core);
	ALPHA = clamp(a, 0.0, 1.0) * aura_color.a;
}
