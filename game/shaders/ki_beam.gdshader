shader_type spatial;
render_mode blend_add, unshaded, cull_disabled, depth_draw_never, shadows_disabled;
// Energy beam for KiBeam.tscn: a cylinder whose UV.y runs along the beam.
// White-hot core, coloured sheath, travelling energy rings and a flared muzzle.

uniform vec4 beam_color : source_color = vec4(0.31, 0.76, 1.0, 1.0);
uniform vec4 core_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float intensity : hint_range(0.0, 4.0) = 1.0;
uniform float flow_speed = 6.0;
uniform float ring_freq = 14.0;
uniform float ring_strength = 0.5;
uniform float core_width : hint_range(0.01, 1.0) = 0.22;
uniform float noise_amount = 0.35;
uniform float tip_glow = 0.6;
uniform float fade_in : hint_range(0.0, 1.0) = 1.0;  // 0..1 growth of the beam

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
	           mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

void fragment() {
	float along = UV.y;               // 0 at the hand, 1 at the tip
	float around = UV.x;

	// radial profile: the cylinder is seen edge on, so use the view-facing rim
	float rim = abs(dot(normalize(NORMAL), normalize(VIEW)));
	float radial = 1.0 - clamp(rim, 0.0, 1.0);      // 0 centre .. 1 silhouette
	float core = 1.0 - smoothstep(0.0, core_width, radial);
	float sheath = 1.0 - smoothstep(core_width, 1.0, radial);

	float flow = vnoise(vec2(around * 8.0, along * 12.0 - TIME * flow_speed));
	float rings = sin((along * ring_freq - TIME * flow_speed) * 6.2831) * 0.5 + 0.5;
	float energy = 1.0 + ring_strength * rings + noise_amount * (flow - 0.5);

	float grow = step(along, fade_in) * (1.0 - smoothstep(fade_in - 0.06, fade_in, along));
	float tip = smoothstep(0.75, 1.0, along) * tip_glow;

	// narrow white-hot core, wide coloured sheath: the technique colour has to read
	vec3 col = mix(beam_color.rgb, core_color.rgb, clamp(pow(core, 1.8), 0.0, 1.0));
	float a = (sheath * 0.42 + core * 0.75) * energy * intensity * grow;
	a += tip * core * 0.5;

	ALBEDO = col * (0.85 + 0.9 * core);
	ALPHA = clamp(a, 0.0, 1.0) * beam_color.a;
}
