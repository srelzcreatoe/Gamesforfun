shader_type spatial;
render_mode blend_mix, cull_disabled, depth_draw_opaque, shadows_disabled;
// Noise dissolve used for dash afterimages, shattering rock cubes and fading debris.
// `dissolve` 0 = solid, 1 = gone. `edge_color` is added to the burning edge.

uniform sampler2D albedo_tex : source_color, filter_nearest, hint_default_white;
uniform vec4 tint : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float dissolve : hint_range(0.0, 1.0) = 0.0;
uniform vec4 edge_color : source_color = vec4(1.0, 0.85, 0.4, 1.0);
uniform float edge_width : hint_range(0.0, 0.4) = 0.12;
uniform float noise_scale = 18.0;
uniform float emission_boost = 0.0;
uniform float alpha_mult : hint_range(0.0, 1.0) = 1.0;

float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.yzx + 33.33);
	return fract((p.x + p.y) * p.z);
}

float vnoise3(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float n000 = hash13(i);
	float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
	float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
	float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
	float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
	float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
	float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
	float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
	return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
	           mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

varying vec3 v_obj;

void vertex() {
	v_obj = VERTEX;
}

void fragment() {
	vec4 tex = texture(albedo_tex, UV) * tint;
	float n = vnoise3(v_obj * noise_scale);
	float cut = n - dissolve;
	if (cut < -edge_width) {
		discard;
	}
	float edge = 1.0 - clamp(cut / max(edge_width, 0.0001), 0.0, 1.0);
	ALBEDO = mix(tex.rgb, edge_color.rgb, edge);
	EMISSION = edge_color.rgb * (edge * 2.0 + emission_boost);
	ALPHA = tex.a * alpha_mult * (1.0 - dissolve * 0.35);
}
