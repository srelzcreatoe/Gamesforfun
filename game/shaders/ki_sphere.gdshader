shader_type spatial;
render_mode blend_add, unshaded, cull_back, depth_draw_never, shadows_disabled;
// Ki blast / charge sphere: white hot centre, coloured plasma shell, swirling surface
// and a soft corona. Used by KiBlast.tscn and the beam's charge ball.

uniform vec4 ki_color : source_color = vec4(0.5, 0.83, 1.0, 1.0);
uniform vec4 core_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float intensity : hint_range(0.0, 4.0) = 1.6;
uniform float swirl_speed = 2.5;
uniform float noise_scale = 4.0;
uniform float corona = 0.8;
uniform float pulse_speed = 9.0;
uniform float pulse_amount = 0.12;

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
	float rim = abs(dot(normalize(NORMAL), normalize(VIEW)));
	float centre = pow(clamp(rim, 0.0, 1.0), 1.6);

	vec2 p = UV * noise_scale;
	float n = vnoise(p + vec2(TIME * swirl_speed, -TIME * swirl_speed * 0.6));
	n = mix(n, vnoise(p * 2.3 - vec2(TIME * swirl_speed * 1.4, 0.0)), 0.5);

	float pulse = 1.0 + sin(TIME * pulse_speed) * pulse_amount;
	vec3 col = mix(ki_color.rgb, core_color.rgb, clamp(centre * 1.3 + n * 0.25, 0.0, 1.0));
	float edge = pow(1.0 - clamp(rim, 0.0, 1.0), 2.0) * corona;
	float a = (0.45 + 0.85 * centre + 0.35 * n + edge) * intensity * pulse;

	ALBEDO = col * (1.0 + 1.5 * centre);
	ALPHA = clamp(a, 0.0, 1.0) * ki_color.a;
}
