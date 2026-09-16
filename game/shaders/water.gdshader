// water.gdshader - voxel water (and lava) surface for Dragon Block Sagas.
//
// Vertex layout produced by ChunkMesher (docs/ARCHITECTURE.md §4):
//   POSITION, NORMAL, UV (0..1 tile uv), UV2 = vec2(layer_index, packed_light / 255.0)
//   with packed_light = sky * 16 + block, COLOR = vec4(tint.rgb, ao).
// Shared uniforms every chunk material gets (SkyController.apply_to_material):
//   sampler2DArray tiles, float daylight, vec3 sun_color, vec3 fog_color, float fog_start,
//   float fog_end, float time, vec3 ambient_color  (+ sun_dir, sky colours, weather_darkness, quality).
// Animated tiles: Textures.build_block_array() puts every frame of an animated strip in its own
// consecutive array layer, so animation = layer + frame, exactly like the chunk shaders.
//
// Original work. Ideas taken from Complementary Reimagined (reference only, no code reused):
// several normal maps at different scales/speeds summed into one bump, fresnel = 1 + dot(N, V),
// water alpha/colour from the depth difference to the scene behind through an exp() curve, and
// pulling the normal back toward the geometric normal when the reflection ray would go inside.

shader_type spatial;
render_mode blend_mix, unshaded, cull_disabled, depth_draw_always, shadows_disabled, fog_disabled;

#include "res://shaders/lib/sky_common.gdshaderinc"

// --- shared chunk uniforms (names are a contract, do not rename) --------------------------------
uniform sampler2DArray tiles : source_color, filter_nearest_mipmap, repeat_enable;
uniform float daylight = 1.0;
uniform vec3 sun_color : source_color = vec3(1.0, 0.93, 0.82);
uniform vec3 fog_color : source_color = vec3(0.72, 0.82, 0.96);
uniform float fog_start = 60.0;
uniform float fog_end = 120.0;
uniform float time = 0.0;
uniform vec3 ambient_color : source_color = vec3(0.35, 0.45, 0.65);

// --- sky (for the reflection and the horizon colour) -------------------------------------------
uniform vec3 sun_dir = vec3(0.0, 0.8, 0.6);
uniform vec3 moon_dir = vec3(0.0, -0.8, -0.6);
uniform vec3 day_color : source_color = vec3(0.21, 0.42, 1.0);
uniform vec3 horizon_color : source_color = vec3(0.62, 0.78, 1.0);
uniform vec3 night_color : source_color = vec3(0.0015, 0.0025, 0.012);
uniform vec3 sunset_color : source_color = vec3(1.0, 0.26, 0.04);
uniform float weather_darkness = 0.0;

// --- water look --------------------------------------------------------------------------------
uniform vec3 water_color : source_color = vec3(0.06, 0.22, 0.55);   // shallow tint
uniform vec3 deep_color : source_color = vec3(0.012, 0.07, 0.21);   // deep tint
uniform vec3 foam_color : source_color = vec3(0.92, 0.97, 1.0);
uniform int quality : hint_range(0, 2) = 2;
uniform int fancy_water : hint_range(0, 1) = 1;   // 0 = no screen refraction (low-end phones)
uniform int is_lava : hint_range(0, 1) = 0;
uniform float underwater = 0.0;                   // 1 while the camera is submerged
uniform float wave_amp : hint_range(0.0, 0.2) = 0.055;
uniform float wave_speed = 1.0;
uniform float ripple_strength : hint_range(0.0, 2.0) = 1.0;
uniform float refraction_strength : hint_range(0.0, 0.1) = 0.022;
uniform float foam_distance : hint_range(0.0, 4.0) = 0.85;
uniform float caustic_strength : hint_range(0.0, 2.0) = 0.8;
uniform int anim_frames = 32;                     // water_still is a 32 frame strip
uniform float anim_fps = 10.0;
uniform float cam_near = 0.05;                    // camera near plane (reverse-Z depth decoding)
uniform int flow_mode : hint_range(0, 2) = 0;     // 0 still, 1 uniform flow_dir, 2 flow packed in UV2.x fraction
uniform vec2 flow_dir = vec2(0.0, 0.0);

uniform sampler2D screen_tex : hint_screen_texture, repeat_disable, filter_linear;
uniform sampler2D depth_tex : hint_depth_texture, repeat_disable, filter_nearest;

varying vec3 v_world;
varying vec3 v_geo_normal;
varying float v_top;
varying vec2 v_flow;

// Three crossing gravity-ish waves. Returns the height and writes the surface slope.
float water_waves(vec2 p, float t, out vec2 slope) {
	vec2 d1 = vec2(0.86, 0.51);
	vec2 d2 = vec2(-0.42, 0.91);
	vec2 d3 = vec2(0.71, -0.70);
	float k1 = 0.55;
	float k2 = 1.13;
	float k3 = 2.21;
	float a1 = 0.55;
	float a2 = 0.30;
	float a3 = 0.15;
	float p1 = dot(p, d1) * k1 + t * 1.10;
	float p2 = dot(p, d2) * k2 - t * 1.43;
	float p3 = dot(p, d3) * k3 + t * 2.10;
	float h = a1 * sin(p1) + a2 * sin(p2) + a3 * sin(p3);
	slope = a1 * k1 * cos(p1) * d1 + a2 * k2 * cos(p2) * d2 + a3 * k3 * cos(p3) * d3;
	return h;
}

void vertex() {
	vec3 world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_geo_normal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	v_top = step(0.5, v_geo_normal.y);
	v_flow = vec2(0.0);
	if (flow_mode == 1) {
		v_flow = flow_dir;
	} else if (flow_mode == 2) {
		// the mesher may pack a 16-way flow direction in the fractional part of the layer index
		float packed = fract(UV2.x) * 16.0;
		float ang = floor(packed) / 16.0 * SC_TAU;
		v_flow = vec2(cos(ang), sin(ang)) * step(0.5, packed);
	}
	if (v_top > 0.5 && is_lava == 0) {
		vec2 slope;
		float h = water_waves(world.xz, time * wave_speed, slope);
		// Chunk meshes (and the preview plane) are axis aligned and unscaled, so displacing the
		// local Y is the same as displacing the world Y - and avoids an inverse() per vertex.
		VERTEX.y += h * wave_amp;
		world.y += h * wave_amp;
		NORMAL = normalize(vec3(-slope.x * wave_amp * 6.0, 1.0, -slope.y * wave_amp * 6.0));
	}
	v_world = world;
}

// Scrolling ripple bump built from two noise gradients at different scales and speeds.
vec3 ripple_normal(vec2 p, float t, float strength) {
	vec2 g = vec2(0.0);
	g += sc_noise_grad(p * 1.7 + vec2(t * 0.09, t * 0.13), 0.08) * 0.55;
	g += sc_noise_grad(p * 5.3 - vec2(t * 0.21, t * 0.07), 0.05) * 0.22;
	if (quality >= 2) {
		g += sc_noise_grad(p * 13.0 + vec2(-t * 0.35, t * 0.28), 0.03) * 0.08;
	}
	return normalize(vec3(-g.x * strength, 1.0, -g.y * strength));
}

void fragment() {
	vec3 cam = INV_VIEW_MATRIX[3].xyz;
	vec3 view_dir = normalize(v_world - cam);              // from the eye toward the surface
	float view_dist = length(v_world - cam);
	float t = time * wave_speed;

	// --- tile colour (animated strip: one array layer per frame) ---------------------------
	float base_layer = floor(UV2.x + 0.5);
	float frame = anim_frames > 1 ? mod(floor(time * anim_fps), float(anim_frames)) : 0.0;
	vec2 tile_uv = UV + v_flow * fract(t * 0.35) * 0.5;
	vec4 tile = texture(tiles, vec3(tile_uv, base_layer + frame));
	vec3 tint = COLOR.rgb;

	// --- voxel light (packed_light = sky * 16 + block) -------------------------------------
	float packed = UV2.y * 255.0;
	float sky_l = floor(packed / 16.0 + 0.001) / 15.0;
	float block_l = fract(packed / 16.0 + 0.001) * 16.0 / 15.0;
	float light = clamp(max(sky_l * mix(0.12, 1.0, daylight), block_l), 0.0, 1.0);
	float ao = mix(1.0, COLOR.a, 0.6);

	vec3 out_col = vec3(0.0);
	float out_alpha = 1.0;

	if (is_lava == 1) {
		// --- lava: emissive, slow moving crust, no reflections ------------------------------
		vec2 lp = v_world.xz * 0.25 + vec2(t * 0.02, -t * 0.015);
		float crust = sc_fbm(lp, quality >= 1 ? 3 : 2);
		vec3 hot = vec3(1.0, 0.42, 0.06) * (1.4 + 1.6 * smoothstep(0.45, 0.85, crust));
		vec3 cool = vec3(0.16, 0.035, 0.015);
		vec3 lava = mix(cool, hot, smoothstep(0.25, 0.8, crust));
		lava *= tile.rgb * 1.6 + vec3(0.35);
		lava += vec3(1.0, 0.55, 0.12) * pow(max(sc_noise(lp * 6.0 + vec2(t * 0.1, 0.0)), 0.0), 6.0) * 1.5;
		out_col = sc_apply_fog(lava, fog_color, view_dist, fog_start, fog_end);
		out_alpha = 1.0;
	} else {
		// --- surface normal: waves + ripples, pulled back when it would face away --------------
		vec3 n = normalize(v_top > 0.5 ? NORMAL : v_geo_normal);
		if (v_top > 0.5 && quality >= 1) {
			vec3 rn = ripple_normal(v_world.xz + v_flow * t * 0.6, t, ripple_strength * 0.35);
			n = normalize(vec3(n.x + rn.x, 1.0, n.z + rn.z));
		}
		float facing = dot(n, -view_dir);
		if (facing < 0.0) {
			n = normalize(mix(n, v_geo_normal, clamp(-facing * 2.0, 0.0, 1.0)));
			facing = max(dot(n, -view_dir), 0.0);
		}
		bool from_below = dot(v_geo_normal, -view_dir) < 0.0 || underwater > 0.5;

		// --- how much water is between this pixel and the scene behind it ----------------------
		float far_fallback = max(fog_end * 4.0, 256.0);
		float raw = texture(depth_tex, SCREEN_UV).r;
		float scene_dist = sc_depth_distance(raw, cam_near, far_fallback);
		float thickness = clamp(scene_dist - view_dist, 0.0, 64.0);
		// depth reads can be unavailable on some drivers (raw stays 0): then treat the water as deep
		float have_depth = step(0.0000011, raw);
		thickness = mix(24.0, thickness, have_depth);

		// --- refraction: the scene behind, displaced by the surface normal ----------------------
		vec2 refr_uv = SCREEN_UV;
		float refr_amount = refraction_strength * clamp(3.0 / max(view_dist, 1.0), 0.1, 1.0);
		refr_uv += n.xz * refr_amount * (1.0 - facing * 0.5);
		refr_uv = clamp(refr_uv, vec2(0.002), vec2(0.998));
		vec3 behind = texture(screen_tex, refr_uv).rgb;

		// --- the water body colour ---------------------------------------------------------------
		vec3 shallow = water_color * tint;
		vec3 deep = deep_color * mix(vec3(1.0), tint, 0.5);
		float depth_mix = 1.0 - exp(-thickness * 0.20);
		vec3 body = mix(shallow, deep, depth_mix);
		body *= (0.25 + 0.95 * light) * ao;
		// a slow large-scale noise breaks up the flat colour (very subtle)
		body *= 0.92 + 0.16 * sc_noise(v_world.xz * 0.12 + vec2(t * 0.01, t * 0.013));

		// how much of the scene behind survives: thin water is nearly clear
		float clarity = exp(-thickness * 0.45) * (fancy_water == 1 ? 1.0 : 0.0);
		vec3 under = mix(body, mix(behind * mix(vec3(1.0), shallow * 2.2 + vec3(0.25), 0.45), body, 0.35), clarity);

		// --- reflection: the sky (or the underwater ceiling from below) -------------------------
		vec3 refl_dir = reflect(view_dir, n);
		refl_dir.y = abs(refl_dir.y) * (from_below ? -1.0 : 1.0);
		vec3 sky = sky_color(normalize(refl_dir), sun_dir, day_color, horizon_color, night_color, sunset_color, weather_darkness);
		if (from_below) {
			// under the surface most directions mirror the dark water; only a bright "window" overhead
			float window = smoothstep(0.55, 0.95, -view_dir.y);
			sky = mix(deep * 1.5, sky * 1.4, window);
		}

		// --- fresnel: schlick, biased so a flat surface still reflects a little ------------------
		float f0 = 0.02;
		float fresnel = f0 + (1.0 - f0) * pow(1.0 - clamp(facing, 0.0, 1.0), 5.0);
		fresnel = clamp(fresnel * (from_below ? 0.55 : 1.0), 0.0, 1.0);
		if (fancy_water == 0) {
			fresnel *= 0.8;
		}

		vec3 col = mix(under, sky, fresnel);

		// --- sun/moon glint (Blinn-Phong) --------------------------------------------------------
		vec3 h_sun = normalize(sun_dir - view_dir);
		float spec = pow(max(dot(n, h_sun), 0.0), 420.0) * 3.2 + pow(max(dot(n, h_sun), 0.0), 48.0) * 0.25;
		col += sun_color * spec * daylight * (1.0 - weather_darkness * 0.8) * (from_below ? 0.2 : 1.0);
		vec3 h_moon = normalize(moon_dir - view_dir);
		col += vec3(0.55, 0.62, 0.9) * pow(max(dot(n, h_moon), 0.0), 380.0) * 1.4 * (1.0 - daylight);

		// --- caustic sparkle on the shallow bottom ----------------------------------------------
		if (quality >= 1 && caustic_strength > 0.0) {
			vec2 cp = v_world.xz * 2.6 + vec2(t * 0.15, -t * 0.11);
			float c1 = sc_noise(cp);
			float c2 = sc_noise(cp * 1.7 + vec2(3.1, 7.7) - vec2(t * 0.08));
			float caustic = pow(max(1.0 - abs(c1 - c2) * 3.4, 0.0), 4.0);
			float shallow_w = exp(-thickness * 0.55) * (1.0 - fresnel);
			col += sun_color * caustic * caustic_strength * shallow_w * daylight * 0.9;
		}

		// --- shore foam --------------------------------------------------------------------------
		float foam = 0.0;
		if (!from_below && foam_distance > 0.0) {
			float edge = 1.0 - smoothstep(0.0, foam_distance, thickness);
			float fn = sc_fbm(v_world.xz * 3.1 + vec2(t * 0.25, -t * 0.18), quality >= 1 ? 3 : 2);
			float band = smoothstep(0.35, 0.75, edge + fn * 0.35 - 0.15);
			foam = clamp(band * edge * have_depth, 0.0, 1.0);
			col = mix(col, foam_color * (0.35 + 0.85 * max(light, daylight * 0.7)), foam * 0.9);
		}

		// --- alpha ------------------------------------------------------------------------------
		float alpha;
		if (fancy_water == 1) {
			// we composited the refracted scene ourselves
			alpha = 1.0;
		} else {
			alpha = clamp(mix(0.55, 0.93, depth_mix) + fresnel * 0.35 + foam * 0.5, 0.0, 1.0);
		}
		if (underwater > 0.5) {
			alpha = min(alpha, 0.85);
		}

		col = sc_apply_fog(col, fog_color, view_dist, fog_start, fog_end);
			out_col = max(col, vec3(0.0));
			out_alpha = alpha;
	}

	ALBEDO = out_col;
	ALPHA = out_alpha;
}
