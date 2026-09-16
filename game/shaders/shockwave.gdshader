shader_type spatial;
render_mode blend_add, unshaded, cull_disabled, depth_draw_never, shadows_disabled;
// Expanding shockwave ring drawn on a flat quad (XZ plane) or a billboard.
// `progress` 0..1 drives the radius; the ring thins and fades as it grows.

uniform vec4 ring_color : source_color = vec4(1.0, 0.98, 0.85, 1.0);
uniform float progress : hint_range(0.0, 1.0) = 0.0;
uniform float thickness : hint_range(0.001, 0.5) = 0.09;
uniform float intensity : hint_range(0.0, 4.0) = 1.4;
uniform float distort = 0.06;
uniform float inner_glow = 0.25;
uniform float ripples = 2.0;

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

void fragment() {
	vec2 c = UV - vec2(0.5);
	float ang = atan(c.y, c.x);
	float r = length(c) * 2.0;                     // 0 centre .. 1 quad edge
	float wob = (hash12(vec2(floor(ang * 12.0), 3.0)) - 0.5) * distort;
	float radius = clamp(progress + wob, 0.0, 1.2);
	float th = thickness * (1.0 - progress * 0.55);
	float ring = 1.0 - smoothstep(0.0, th, abs(r - radius));
	float second = (1.0 - smoothstep(0.0, th * 0.6, abs(r - radius * 0.62))) * 0.45 * step(1.5, ripples);
	float glow = (1.0 - smoothstep(0.0, radius, r)) * inner_glow * (1.0 - progress);
	float fade = 1.0 - smoothstep(0.55, 1.0, progress);
	ALBEDO = ring_color.rgb * (1.0 + ring);
	ALPHA = clamp((ring + second + glow) * intensity * fade, 0.0, 1.0) * ring_color.a;
}
