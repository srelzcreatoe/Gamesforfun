// clouds.gdshader - two big fbm cloud planes that follow the camera (scripts/world/Clouds.gd).
//
// Original work for Dragon Block Sagas. The look (fluffy coverage-thresholded fbm, bright sun-facing
// edges, dark undersides, warm sunset rim) follows the style of Complementary Reimagined's
// "reimagined clouds"; the maths here is ours: no raymarch, just one fbm lookup plus a second lookup
// offset toward the sun to fake self-shadowing, which keeps the whole thing phone friendly.
//
// UNIFORM PACKING PASS (shaders agent): 22 uniforms -> 10. The shared sky/light values travel in the
// same vec4s as in chunk_opaque / water (SkyController.apply_to_material pushes them), the per-layer
// settings travel in three cloud-only vec4s that Clouds.gd fills, and `layer_scale * layer_parallax`
// is now pushed as the single product the shader always used. GLES3 only guarantees 224 fragment
// uniform vectors and a failed link leaves Godot drawing with an unbound shader (a native crash on
// real phone drivers), so every world shader has to stay lean.
//
// The one deliberate difference: the faint "sky behind the clouds" bleed at night used to take
// `day_color`; it now takes `horizon_color` for both ends of that gradient, which lets this shader
// drop the sky_day_params slot entirely. The term is multiplied by 0.12 * (1 - daylight), so it is
// zero by day and night-sky coloured after dusk either way.

shader_type spatial;
render_mode blend_mix, unshaded, cull_disabled, depth_draw_never, shadows_disabled, fog_disabled;

#include "res://shaders/lib/sky_common.gdshaderinc"

// --- packed shared lighting / sky contract (identical in every world shader) ---------------------
//   sun_params          xyz sun colour      w daylight
//   fog_params          xyz fog colour      w fog_start   (clouds ignore .w)
//   ambient_params      xyz ambient colour  w fog_end     (clouds ignore .w)
//   sun_dir_params      xyz direction TO the sun          w time (seconds)
//   sky_horizon_params  xyz horizon colour  w weather_darkness
//   sky_night_params    xyz night colour    w min_daylight
//   sky_sunset_params   xyz sunset colour   w view_flags = quality + 4*fancy_water + 8*underwater
uniform vec4 sun_params = vec4(1.0, 0.93, 0.82, 1.0);
uniform vec4 fog_params = vec4(0.72, 0.82, 0.96, 48.0);
uniform vec4 ambient_params = vec4(0.35, 0.45, 0.65, 96.0);
uniform vec4 sun_dir_params = vec4(0.0, 0.8, 0.6, 0.0);
uniform vec4 sky_horizon_params = vec4(0.62, 0.78, 1.0, 0.0);
uniform vec4 sky_night_params = vec4(0.0015, 0.0025, 0.012, 0.0);
uniform vec4 sky_sunset_params = vec4(1.0, 0.26, 0.04, 6.0);

// --- the cloud-only slots (scripts/world/Clouds.gd owns them) -----------------------------------
//   cloud_layer_params  x layer_scale * layer_parallax (world metres -> noise units; the two are
//                         only ever used as that product), y opacity, z softness, w fade_start
//   cloud_wind_params   xy wind (direction * speed), z coverage 0.3 clear .. 0.9 storm, w fade_end
//   cloud_tint_params   xyz cloud tint (w reserved)
uniform vec4 cloud_layer_params = vec4(0.0022, 0.95, 0.28, 260.0);
uniform vec4 cloud_wind_params = vec4(0.6, 0.18, 0.45, 1500.0);
uniform vec4 cloud_tint_params = vec4(1.0, 1.0, 1.0, 0.0);

void vertex() {
	// The plane mesh is huge and centred on the camera; nothing to animate in the vertex stage.
	UV = UV;
}

void fragment() {
	// --- unpack ------------------------------------------------------------------------------
	vec3 sun_color = sun_params.rgb;
	float daylight = sun_params.w;
	vec3 fog_color = fog_params.rgb;
	vec3 ambient_color = ambient_params.rgb;
	vec3 sun_dir = sun_dir_params.xyz;
	float time = sun_dir_params.w;
	vec3 horizon_color = sky_horizon_params.rgb;
	float weather_darkness = sky_horizon_params.w;
	vec3 night_color = sky_night_params.rgb;
	float min_daylight = sky_night_params.w;
	vec3 sunset_color = sky_sunset_params.rgb;
	int quality = int(mod(sky_sunset_params.w, 4.0));
	float layer_step = cloud_layer_params.x;
	float layer_opacity = cloud_layer_params.y;
	float softness = cloud_layer_params.z;
	float fade_start = cloud_layer_params.w;
	vec2 wind = cloud_wind_params.xy;
	float coverage = cloud_wind_params.z;
	float fade_end = cloud_wind_params.w;
	vec3 cloud_tint = cloud_tint_params.rgb;

	vec3 world = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec3 cam = INV_VIEW_MATRIX[3].xyz;
	vec2 flat_off = world.xz - cam.xz;
	float dist = length(flat_off);

	// --- density field ---------------------------------------------------------------------
	int oct = quality >= 2 ? 4 : (quality >= 1 ? 3 : 2);
	vec2 p = world.xz * layer_step + wind * time * 0.02;
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
	float step_len = 0.55 / max(layer_step * 320.0, 0.05);
	float d_sun = sc_fbm(p + sun_flat * layer_step * step_len * 120.0, max(oct - 1, 1));
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
	// night clouds keep a hint of the sky behind them (horizon colour stands in for day_color:
	// this term only survives after dusk, see the header)
	col += sky_color_min(normalize(vec3(flat_off.x, 60.0, flat_off.y)), sun_dir, horizon_color,
			horizon_color, night_color, sunset_color, weather_darkness, min_daylight)
			* 0.12 * (1.0 - daylight);

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
