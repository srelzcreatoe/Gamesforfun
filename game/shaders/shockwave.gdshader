shader_type spatial;
render_mode blend_add, unshaded, cull_disabled, depth_draw_never, shadows_disabled;
// Expanding shockwave ring drawn on a flat quad (XZ plane) or a billboard.
// `progress` 0..1 drives the radius; the ring thins and fades as it grows.

uniform vec4 ring_color : source_color = vec4(1.0, 0.98, 0.85, 1.0);
uniform float progress : hint_range(0.0, 1.0) = 0.0;
uniform float thickness : hint_range(0.001, 0.5) = 0.09;
uniform float intensity : hint_range(0.0, 4.0) = 1.4;
uniform float distort = 0.035;
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
	// smooth angular wobble: interpolate between 24 sectors so the ring reads as a
	// slightly uneven wave front instead of the dashed polygon a hard floor() gives
	float sect = (ang + 3.14159265) / 6.2831853 * 24.0;
	float s0 = hash12(vec2(floor(sect), 3.0));
	float s1 = hash12(vec2(mod(floor(sect) + 1.0, 24.0), 3.0));
	float sf = fract(sect);
	sf = sf * sf * (3.0 - 2.0 * sf);
	float wob = (mix(s0, s1, sf) - 0.5) * distort;
	float radius = clamp(progress + wob, 0.0, 1.2);
	float th = thickness * (1.0 - progress * 0.55);
	float ring = 1.0 - smoothstep(0.0, th, abs(r - radius));
	float second = (1.0 - smoothstep(0.0, th * 0.6, abs(r - radius * 0.62))) * 0.45 * step(1.5, ripples);
	// NOTE: smoothstep(0, 0, r) is undefined in GLSL and returned 1.0 - i.e. a flat
	// wash over the whole quad - on llvmpipe/GLES, so clamp the edge apart and fade
	// the disc in with the radius instead
	float rad_safe = max(radius, 0.02);
	float glow = (1.0 - smoothstep(0.0, rad_safe, r)) * inner_glow * (1.0 - progress) * smoothstep(0.0, 0.12, progress);
	float fade = 1.0 - smoothstep(0.55, 1.0, progress);
	ALBEDO = ring_color.rgb * (1.0 + ring);
	ALPHA = clamp((ring + second + glow) * intensity * fade, 0.0, 1.0) * ring_color.a;
}
