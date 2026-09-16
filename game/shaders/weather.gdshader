// weather.gdshader - rain / snow sheets around the camera (scripts/world/Weather.gd).
//
// Drawn on two nested open cylinders that ride with the camera. The sprite strips come from
// assets/textures/environment/weather.png (Fused pack): rows 5..19 are the rain streaks, rows 0..2
// the snow flakes, so `sprite_rect` selects the region instead of needing two textures.
//
// Original work. Uniforms: sprite_rect, tile_count, fall_speed, sway, intensity, tint, time,
// kind (0 = rain, 1 = snow), quality.

shader_type spatial;
render_mode blend_mix, unshaded, cull_disabled, depth_draw_never, shadows_disabled, fog_disabled;

#include "res://shaders/lib/sky_common.gdshaderinc"

uniform sampler2D weather_tex : source_color, filter_nearest, repeat_enable;
uniform vec4 sprite_rect = vec4(0.0, 0.15625, 1.0, 0.46875);   // x, y, w, h in uv (rain rows 5..19)
uniform vec2 tile_count = vec2(28.0, 6.0);                     // repeats around / up the cylinder
uniform float fall_speed = 3.2;
uniform float sway = 0.12;
uniform float intensity : hint_range(0.0, 1.0) = 0.0;
uniform vec3 tint : source_color = vec3(0.78, 0.84, 0.95);
uniform float time = 0.0;
uniform int kind : hint_range(0, 1) = 0;
uniform int quality : hint_range(0, 2) = 2;
uniform float layer_seed = 0.0;

void fragment() {
	if (intensity <= 0.003) {
		discard;
	}
	vec2 uv = UV * tile_count;
	float t = time;
	if (kind == 1) {
		// snow drifts: slower fall plus a horizontal wobble that depends on the column
		uv.y -= t * fall_speed * 0.28;
		uv.x += sin(t * 0.55 + uv.y * 0.9 + layer_seed) * sway * 2.2;
	} else {
		uv.y -= t * fall_speed;
		uv.x += sin(t * 0.8 + layer_seed) * sway * 0.25;
	}
	vec2 cell = floor(uv);
	vec2 f = fract(uv);
	// per-cell jitter so the tiling does not read as a grid
	vec2 jitter = vec2(sc_hash12(cell + layer_seed), sc_hash12(cell.yx + 3.7 + layer_seed));
	f = fract(f + jitter * 0.5);
	vec2 tex_uv = sprite_rect.xy + f * sprite_rect.zw;
	vec4 s = texture(weather_tex, tex_uv);

	// gusts: whole patches of the sheet thin out and thicken again
	float gust = sc_fbm(vec2(cell.x * 0.35, cell.y * 0.12 + t * 0.35), 2);
	float density = smoothstep(0.42 - 0.35 * intensity, 0.80 - 0.30 * intensity, gust + jitter.x * 0.25);

	float a = s.a * density * intensity;
	// fade out at the top and bottom of the cylinder so the sheet has no visible seam
	a *= smoothstep(0.0, 0.16, UV.y) * (1.0 - smoothstep(0.86, 1.0, UV.y));
	if (a <= 0.004) {
		discard;
	}
	// rain reads as a slightly darker, desaturated streak over bright ground and a bright one
	// against a dark sky, which is what makes it visible in both cases
	vec3 col = s.rgb * tint;
	if (kind == 1) {
		col = tint * 1.2;
	}
	ALBEDO = col;
	ALPHA = clamp(a * (kind == 1 ? 0.95 : 0.85), 0.0, 1.0);
}
