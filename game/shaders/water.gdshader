// water.gdshader - voxel liquids (water and lava) for Dragon Block Sagas.
//
// FINAL version by the shaders agent, built on the voxel agent's functional first pass:
// the uniform names, the UV2 packing and the Minecraft-style face/light model are unchanged, so
// ChunkMesher and World keep working as before. What is new: sky reflection through a Fresnel
// term, screen-space refraction, depth-based water colour, shore foam, caustic sparkle, sun/moon
// glint, an underwater look and the `is_lava` variant.
//
// Vertex stream (identical to chunk_opaque.gdshader):
//   UV      0..1 tile uv
//   UV2.x   texture array layer + (frames + sway * 64) / 128     (frames are consecutive layers)
//   UV2.y   packed light / 255                                   (packed = sky * 16 + block)
//   COLOR   rgb = biome water tint, a = ambient occlusion
//
// Uniforms the World pushes every frame (see SkyController.apply_to_material): tiles, daylight,
// sun_color, fog_color, ambient_color, fog_start, fog_end, time - plus, for the reflection,
// sun_dir, moon_dir, day_color, horizon_color, night_color, sunset_color, weather_darkness,
// quality, fancy_water and underwater. All of them have usable defaults, so the shader still
// renders correctly if only the seven original uniforms are set.
//
// Original work. Ideas studied in Complementary Reimagined (reference only, no code reused):
// summing several normal maps at different scales and speeds, water opacity/colour from the depth
// difference to the scene behind through an exp() curve, and pulling the surface normal back
// toward the geometric normal when a reflection ray would point into the water.

shader_type spatial;
render_mode blend_mix, cull_disabled, depth_draw_always, unshaded, shadows_disabled, fog_disabled;

#include "res://shaders/lib/sky_common.gdshaderinc"

// --- the voxel agent's contract (do not rename) -------------------------------------------------
uniform sampler2DArray tiles : source_color, filter_nearest_mipmap, repeat_disable;
uniform float daylight = 1.0;
uniform vec3 sun_color : source_color = vec3(1.0, 0.96, 0.9);
uniform vec3 fog_color : source_color = vec3(0.75, 0.84, 0.96);
uniform vec3 ambient_color : source_color = vec3(0.45, 0.52, 0.66);
uniform float fog_start = 48.0;
uniform float fog_end = 96.0;
uniform float time = 0.0;
uniform float anim_fps = 10.0;
uniform float wave_height = 0.055;        // total wave amplitude in metres (<= 0.06)
uniform float wave_speed = 1.5;
uniform float water_alpha = 0.78;         // base opacity when screen refraction is off
uniform float fresnel_strength = 0.35;    // extra weight on the sky reflection

// --- sky (reflection colour, shared with sky.gdshader through sky_common) -----------------------
uniform vec3 sun_dir = vec3(0.0, 0.8, 0.6);
uniform vec3 moon_dir = vec3(0.0, -0.8, -0.6);
uniform vec3 day_color : source_color = vec3(0.21, 0.42, 1.0);
uniform vec3 horizon_color : source_color = vec3(0.62, 0.78, 1.0);
uniform vec3 night_color : source_color = vec3(0.0015, 0.0025, 0.012);
uniform vec3 sunset_color : source_color = vec3(1.0, 0.26, 0.04);
uniform float weather_darkness = 0.0;

// --- look / quality ----------------------------------------------------------------------------
uniform vec3 water_color : source_color = vec3(0.09, 0.28, 0.62);   // shallow tint (biome water colour)
uniform vec3 deep_color : source_color = vec3(0.012, 0.075, 0.22);  // deep tint
uniform vec3 foam_color : source_color = vec3(0.92, 0.97, 1.0);
uniform int quality : hint_range(0, 2) = 2;      // 0 phone/low, 1 balanced, 2 high
uniform int fancy_water : hint_range(0, 1) = 1;  // 0 = no screen refraction, classic alpha blend
uniform int is_lava : hint_range(0, 1) = 0;
uniform float underwater = 0.0;                  // 1 while the camera is submerged
uniform float ripple_strength : hint_range(0.0, 2.0) = 1.0;
uniform float refraction_strength : hint_range(0.0, 0.1) = 0.022;
uniform float foam_distance : hint_range(0.0, 4.0) = 0.45;
uniform float caustic_strength : hint_range(0.0, 2.0) = 0.8;
uniform float cam_near = 0.05;                   // camera near plane (reverse-Z depth decoding)
uniform int debug_view : hint_range(0, 3) = 0;   // 1 = thickness, 2 = normal, 3 = foam mask

uniform sampler2D screen_tex : hint_screen_texture, repeat_disable, filter_linear;
uniform sampler2D depth_tex : hint_depth_texture, repeat_disable, filter_nearest;

varying vec3 v_uv_layer;
varying vec3 v_normal;
varying vec3 v_world;
varying float v_light;
varying float v_top;
varying float v_wave;

const vec3 BLOCK_LIGHT_COLOR = vec3(1.0, 0.82, 0.58);

// Minecraft-style per-face shading, kept identical to the chunk shaders.
float face_factor(vec3 n) {
	if (n.y > 0.5) {
		return 1.0;
	}
	if (n.y < -0.5) {
		return 0.5;
	}
	if (abs(n.z) > 0.5) {
		return 0.8;
	}
	return 0.6;
}

// Three crossing gravity-ish waves; also returns the surface slope for the normal.
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
	slope = a1 * k1 * cos(p1) * d1 + a2 * k2 * cos(p2) * d2 + a3 * k3 * cos(p3) * d3;
	return a1 * sin(p1) + a2 * sin(p2) + a3 * sin(p3);
}

// Scrolling ripple bump from two (three on high) noise gradients at different scales and speeds.
vec3 ripple_normal(vec2 p, float t, float strength) {
	vec2 g = vec2(0.0);
	g += sc_noise_grad(p * 1.7 + vec2(t * 0.09, t * 0.13), 0.08) * 0.55;
	g += sc_noise_grad(p * 5.3 - vec2(t * 0.21, t * 0.07), 0.05) * 0.22;
	if (quality >= 2) {
		g += sc_noise_grad(p * 13.0 + vec2(-t * 0.35, t * 0.28), 0.03) * 0.08;
	}
	return normalize(vec3(-g.x * strength, 1.0, -g.y * strength));
}

void vertex() {
	// UV2.x packing (voxel agent): integer part = base array layer, fraction * 128 = frames + sway * 64.
	float layer = floor(UV2.x);
	float enc = floor(fract(UV2.x) * 128.0 + 0.5);
	float sway_flag = step(64.0, enc);
	float frames = enc - sway_flag * 64.0;
	if (frames > 1.5) {
		layer += floor(mod(time * anim_fps, frames));
	}
	v_uv_layer = vec3(UV, layer);
	v_normal = NORMAL;
	v_light = UV2.y;
	v_top = step(0.5, NORMAL.y);
	v_wave = 0.0;
	vec3 world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	if (v_top > 0.5 && is_lava == 0) {
		vec2 slope;
		float h = water_waves(world.xz, time * wave_speed, slope);
		// A liquid's top face already sits 1/8 block below the block top, so a <= 0.06 m crest
		// never pokes through the block above. Chunk meshes are unrotated, so local Y == world Y.
		VERTEX.y += h * wave_height;
		world.y += h * wave_height;
		v_wave = h;
		v_normal = normalize(vec3(-slope.x * wave_height * 6.0, 1.0, -slope.y * wave_height * 6.0));
	}
	v_world = world;
}

void fragment() {
	vec3 cam = INV_VIEW_MATRIX[3].xyz;
	vec3 view_dir = normalize(v_world - cam);          // eye -> surface
	float view_dist = length(v_world - cam);
	float t = time * wave_speed;

	vec4 tex = texture(tiles, v_uv_layer);
	vec3 tint = COLOR.rgb;

	// --- voxel light, exactly like the chunk shaders ----------------------------------------
	float packed = floor(v_light * 255.0 + 0.5);
	float sky_raw = floor(packed * 0.0625);
	float sky_l = sky_raw / 15.0;
	float blk = (packed - sky_raw * 16.0) / 15.0;
	vec3 sky_part = sky_l * daylight * mix(ambient_color, sun_color, clamp(daylight, 0.0, 1.0));
	vec3 blk_part = blk * BLOCK_LIGHT_COLOR;
	vec3 light = max(sky_part, blk_part) + ambient_color * 0.15;
	float face = face_factor(normalize(v_normal));

	vec3 out_col = vec3(0.0);
	float out_alpha = 1.0;

	if (is_lava == 1) {
		// --- lava: emissive crust, slow flow, no reflection ----------------------------------
		vec2 lp = v_world.xz * 0.25 + vec2(t * 0.012, -t * 0.009);
		float crust = sc_fbm(lp, quality >= 1 ? 3 : 2);
		vec3 hot = vec3(1.0, 0.42, 0.06) * (1.3 + 1.7 * smoothstep(0.45, 0.85, crust));
		vec3 cool = vec3(0.17, 0.04, 0.02);
		vec3 lava = mix(cool, hot, smoothstep(0.25, 0.8, crust));
		lava *= tex.rgb * 1.5 + vec3(0.4);
		lava += vec3(1.0, 0.55, 0.12) * pow(max(sc_noise(lp * 6.0 + vec2(t * 0.06, 0.0)), 0.0), 6.0) * 1.4;
		out_col = sc_apply_fog(lava * face, fog_color, view_dist, fog_start, fog_end);
		out_alpha = 1.0;
	} else {
		// --- surface normal ------------------------------------------------------------------
		vec3 n = normalize(v_normal);
		if (v_top > 0.5 && quality >= 1) {
			vec3 rn = ripple_normal(v_world.xz, t, ripple_strength * 0.35);
			n = normalize(vec3(n.x + rn.x, 1.0, n.z + rn.z));
		}
		float facing = dot(n, -view_dir);
		if (facing < 0.0) {
			// the wave normal turned away from the eye: blend back to the flat face
			n = normalize(mix(n, normalize(v_normal), clamp(-facing * 2.0, 0.0, 1.0)));
			facing = max(dot(n, -view_dir), 0.0);
		}
		bool from_below = dot(normalize(v_normal), -view_dir) < 0.0 || underwater > 0.5;

		// --- how much water sits between this pixel and the scene behind it ------------------
		float far_fallback = max(fog_end * 4.0, 256.0);
		float raw = texture(depth_tex, SCREEN_UV).r;
		float have_depth = step(0.0000011, raw);
		float scene_dist = sc_depth_distance(raw, cam_near, far_fallback);
		float thickness = clamp(scene_dist - view_dist, 0.0, 64.0);
		// If the driver gives us no depth (or we look at the open sea) treat the water as deep.
		thickness = mix(24.0, thickness, have_depth);

		// --- refracted scene behind the surface ----------------------------------------------
		vec2 refr_uv = SCREEN_UV + n.xz * refraction_strength
				* clamp(3.0 / max(view_dist, 1.0), 0.15, 1.0) * (1.0 - facing * 0.5);
		vec3 behind = texture(screen_tex, clamp(refr_uv, vec2(0.002), vec2(0.998))).rgb;

		// --- water body colour ----------------------------------------------------------------
		// thin water over sand reads much lighter than the open sea
		vec3 shallow = water_color * tint * (tex.rgb * 0.5 + 0.6);
		vec3 very_shallow = shallow * 1.7 + vec3(0.02, 0.07, 0.06);
		vec3 deep = deep_color * mix(vec3(1.0), tint, 0.5);
		float shore_mix = exp(-thickness * 1.1);
		shallow = mix(shallow, very_shallow, shore_mix);
		float depth_mix = 1.0 - exp(-thickness * 0.24);
		vec3 body = mix(shallow, deep, depth_mix) * light * COLOR.a;
		body *= 0.94 + 0.12 * sc_noise(v_world.xz * 0.12 + vec2(t * 0.01, t * 0.013));
		float clarity = exp(-thickness * 0.45) * float(fancy_water);
		vec3 under = mix(body, mix(behind * (shallow * 1.6 + vec3(0.45)), body, 0.3), clarity);

		// --- reflected sky --------------------------------------------------------------------
		vec3 refl_dir = reflect(view_dir, n);
		refl_dir.y = from_below ? -abs(refl_dir.y) : abs(refl_dir.y);
		vec3 sky = sky_color(normalize(refl_dir), sun_dir, day_color, horizon_color, night_color,
				sunset_color, weather_darkness);
		if (from_below) {
			// under the surface almost everything mirrors the dark water; only a bright window overhead
			float window = smoothstep(0.55, 0.95, -view_dir.y);
			sky = mix(deep * 2.0, sky * 1.3, window);
		}

		// --- Fresnel (Schlick) -----------------------------------------------------------------
		float f0 = 0.02;
		float fresnel = f0 + (1.0 - f0) * pow(1.0 - clamp(facing, 0.0, 1.0), 5.0);
		fresnel = clamp(fresnel * (1.0 + fresnel_strength) * (from_below ? 0.5 : 1.0), 0.0, 1.0);
		vec3 col = mix(under, sky, fresnel);

		// --- sun and moon glint ----------------------------------------------------------------
		vec3 h_sun = normalize(sun_dir - view_dir);
		float ndh = max(dot(n, h_sun), 0.0);
		float spec = pow(ndh, 420.0) * 3.4 + pow(ndh, 48.0) * 0.22;
		col += sun_color * spec * daylight * (1.0 - weather_darkness * 0.8) * (from_below ? 0.2 : 1.0);
		col += vec3(0.55, 0.62, 0.9) * pow(max(dot(n, normalize(moon_dir - view_dir)), 0.0), 380.0)
				* 1.6 * (1.0 - daylight);

		// --- caustic sparkle on a shallow bottom ------------------------------------------------
		if (quality >= 1 && caustic_strength > 0.0) {
			vec2 cp = v_world.xz * 2.6 + vec2(t * 0.09, -t * 0.07);
			float c1 = sc_noise(cp);
			float c2 = sc_noise(cp * 1.7 + vec2(3.1, 7.7) - vec2(t * 0.05));
			float caustic = pow(max(1.0 - abs(c1 - c2) * 3.4, 0.0), 4.0);
			col += sun_color * caustic * caustic_strength * exp(-thickness * 0.5)
					* (1.0 - fresnel) * daylight * 0.9;
		}

		// --- shore foam -------------------------------------------------------------------------
		float foam = 0.0;
		if (!from_below && foam_distance > 0.0 && have_depth > 0.5) {
			// the surf line advances and retreats with the wave crests
			float edge = 1.0 - smoothstep(0.0, foam_distance, thickness + v_wave * 0.22);
			// two noise fields at different speeds break the band into moving lace
			float fn = sc_fbm(v_world.xz * 3.1 + vec2(t * 0.16, -t * 0.12), quality >= 1 ? 3 : 2);
			float fn2 = sc_noise(v_world.xz * 7.0 - vec2(t * 0.3, t * 0.22));
			foam = clamp(smoothstep(0.52, 0.95, edge * 0.75 + fn * 0.5 + fn2 * 0.2) * edge, 0.0, 1.0);
			col = mix(col, foam_color * (0.1 + 0.95 * max(sky_l * daylight, blk)), foam * 0.72);
		}

		float alpha = 1.0;
		if (fancy_water == 0) {
			alpha = clamp(mix(water_alpha * 0.8, 0.95, depth_mix) + fresnel * 0.3 + foam * 0.5, 0.0, 1.0);
		}
		if (underwater > 0.5) {
			alpha = min(alpha, 0.85);
		}

		out_col = max(sc_apply_fog(col, fog_color, view_dist, fog_start, fog_end), vec3(0.0));
		out_alpha = alpha;

		if (debug_view == 1) {
			out_col = vec3(fract(thickness), thickness / 16.0, have_depth);
			out_alpha = 1.0;
		} else if (debug_view == 2) {
			out_col = n * 0.5 + 0.5;
			out_alpha = 1.0;
		} else if (debug_view == 3) {
			out_col = vec3(foam);
			out_alpha = 1.0;
		}
	}

	ALBEDO = out_col;
	ALPHA = out_alpha;
}
