// clouds.gdshader - two big fbm cloud planes that follow the camera (scripts/world/Clouds.gd).
//
// Original work for Dragon Block Sagas. The look (fluffy coverage-thresholded fbm, bright sun-facing
// edges, dark undersides, warm sunset rim) follows the style of Complementary Reimagined's
// "reimagined clouds"; the maths here is ours: no raymarch, just one fbm lookup plus a second lookup
// offset toward the sun to fake self-shadowing, which keeps the whole thing phone friendly.
//
// Uniform contract (SkyController/Clouds.gd push these):
//   day_color, horizon_color, night_color, sunset_color, cloud_tint, sun_color, ambient_color, fog_color
//   sun_dir, daylight, coverage (0.3 clear .. 0.9 storm), weather_darkness, time, quality (0/1/2)
//   layer_scale, layer_height, layer_opacity, wind (vec2 direction * speed), fade_start, fade_end

shader_type spatial;
render_mode blend_mix, unshaded, cull_disabled, depth_draw_never, shadows_disabled, fog_disabled;

#include "res://shaders/lib/sky_common.gdshaderinc"

uniform vec3 day_color : source_color = vec3(0.21, 0.42, 1.0);
uniform vec3 horizon_color : source_color = vec3(0.62, 0.78, 1.0);
uniform vec3 night_color : source_color = vec3(0.0015, 0.0025, 0.012);
uniform vec3 sunset_color : source_color = vec3(1.0, 0.26, 0.04);
uniform vec3 cloud_tint : source_color = vec3(1.0, 1.0, 1.0);
uniform vec3 sun_color : source_color = vec3(1.0, 0.93, 0.82);
uniform vec3 ambient_color : source_color = vec3(0.35, 0.45, 0.65);
uniform vec3 fog_color : source_color = vec3(0.72, 0.82, 0.96);
uniform vec3 sun_dir = vec3(0.0, 0.8, 0.6);
uniform float daylight = 1.0;
uniform float coverage = 0.45;
uniform float weather_darkness = 0.0;
uniform float min_daylight = 0.0;
uniform float time = 0.0;
uniform int quality = 2;

uniform float layer_scale = 0.0022;   // world metres -> noise units
uniform float layer_opacity = 0.95;
uniform float layer_parallax = 1.0;   // 1 = lower layer, ~0.55 = upper layer (slower = further away)
uniform vec2 wind = vec2(0.6, 0.18);
uniform float fade_start = 260.0;
uniform float fade_end = 1500.0;
uniform float softness = 0.28;

void vertex() {
	// The plane mesh is huge and centred on the camera; nothing to animate in the vertex stage.
	UV = UV;
}

void fragment() {
	vec3 world = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec3 cam = INV_VIEW_MATRIX[3].xyz;
	vec2 flat_off = world.xz - cam.xz;
	float dist = length(flat_off);

	// --- density field ---------------------------------------------------------------------
	int oct = quality >= 2 ? 4 : (quality >= 1 ? 3 : 2);
	vec2 p = world.xz * layer_scale * layer_parallax + wind * time * 0.02;
	float d = sc_fbm(p, oct);
	// a second, much larger scale decides where cloud *systems* sit, so the sky is not uniform mush
	float systems = sc_fbm(p * 0.21 + vec2(4.7, 1.9), 2);
	d = d * 0.72 + systems * 0.38;

	float thresh = 1.0 - clamp(coverage, 0.0, 1.0);
	float soft = mix(softness, softness * 0.55, clamp(coverage, 0.0, 1.0));
	float density = smoothstep(thresh, thresh + soft, d);
	if (density <= 0.002) {
		discard;
	}

	// --- fake self shadowing: sample the field again, offset toward the sun ------------------
	vec2 sun_flat = normalize(sun_dir.xz + vec2(0.0001, 0.0));
	float step_len = 0.55 / max(layer_scale * layer_parallax * 320.0, 0.05);
	float d_sun = sc_fbm(p + sun_flat * layer_scale * layer_parallax * step_len * 120.0, max(oct - 1, 1));
	d_sun = d_sun * 0.72 + systems * 0.38;
	float toward_light = clamp((d - d_sun) * 2.6 + 0.35, 0.0, 1.0);

	// thin edges scatter light, cores block it
	float thickness = smoothstep(thresh, 1.0, d);
	float rim = 1.0 - thickness;

	// --- colours ---------------------------------------------------------------------------
	float dusk = sky_dusk(sun_dir.y);
	vec3 lit = sun_color * (1.35 + 1.1 * rim);
	lit = mix(lit, sunset_color * 2.2 + sun_color * 0.4, dusk * 0.8);
	vec3 shade = mix(ambient_color * 1.2, horizon_color * 0.55, 0.45);
	shade = mix(shade, night_color * 2.0 + ambient_color * 0.55, 1.0 - daylight);
	vec3 col = mix(shade, lit, toward_light * (0.25 + 0.75 * daylight));
	col *= cloud_tint;
	// storms: grey, dark, flat
	float lum = sc_luma(col);
	col = mix(col, vec3(lum) * vec3(0.86, 0.88, 0.94), weather_darkness * 0.8);
	col *= 1.0 - 0.55 * weather_darkness;
	// night clouds keep a hint of the sky behind them
	col += sky_color_min(normalize(vec3(flat_off.x, 60.0, flat_off.y)), sun_dir, day_color, horizon_color,
			night_color, sunset_color, weather_darkness, min_daylight) * 0.12 * (1.0 - daylight);

	// --- alpha: coverage, distance fade, grazing-angle fade ---------------------------------
	float a = density * layer_opacity;
	a *= 1.0 - smoothstep(fade_start, fade_end, dist);
	// hide the plane's rim: clouds thin out where we look almost along the plane
	vec3 view_dir = normalize(world - cam);
	a *= smoothstep(0.035, 0.22, abs(view_dir.y));
	a = clamp(a, 0.0, 1.0);
	// blend the far edge into the fog/horizon colour so there is no hard cut
	col = mix(col, fog_color, smoothstep(fade_start * 0.75, fade_end, dist) * 0.7);

	ALBEDO = max(col, vec3(0.0));
	ALPHA = a;
}
