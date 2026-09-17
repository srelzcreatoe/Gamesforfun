// chunk_cutout.gdshader - alpha-scissor voxel geometry: leaves, plants, glass, torches, doors.
//
// Written by the voxel agent, polished later by the shaders agent: KEEP THE UNIFORM NAMES.
// Same vertex stream as chunk_opaque.gdshader (see its header for UV2/COLOR packing), except:
//   * the biome tint is applied to the whole texel (plants are fully tinted, not masked),
//   * ALPHA_SCISSOR_THRESHOLD 0.5 punches out the transparent texels,
//   * the wind moves plants and leaves (glass/doors/torches stay still), driven entirely in
//     the vertex shader so it is free on mobile:
//       sway_mode 1 (cross/crop plants) bends the top half of the tile only, anchored at the
//         base, and sway_mode 2 (leaf blocks) drifts the whole cube.
//       The travelling wave's phase depends only on the vertex's world position, so vertices
//         shared by neighbouring blocks move identically and no cracks open in a canopy; a
//         per-block hash only nudges the phase (amplitude ~0.01 m).
//       `disturb[0..disturb_count-1]` are world-space pushes (xyz = position, w = strength):
//         the player's feet and recent impacts, so grass and leaves part around whatever moves
//         through them. World.gd fills them (see World.add_disturbance).
//
// UV2.x = layer + (frames + 64 * sway_mode) / 256   (sway_mode: 0 static, 1 plant, 2 leaves)

//
// POLISH PASS (shaders agent): the uniform names, the vertex stream and the Minecraft-style
// face/light model are untouched. What changed: the distance fog uses a smoothstep curve with a
// dither instead of a hard linear ramp (no banding in gradients), sky light picks up a small
// directional term from `sun_dir` so slopes facing the sun read slightly warmer, and block light
// flickers very slightly (`light_flicker`, set it to 0 to switch that off).

shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_opaque;

uniform sampler2DArray tiles : source_color, filter_nearest_mipmap, repeat_disable;
uniform float daylight = 1.0;
uniform vec3 sun_color : source_color = vec3(1.0, 0.96, 0.9);
uniform vec3 fog_color : source_color = vec3(0.75, 0.84, 0.96);
uniform vec3 ambient_color : source_color = vec3(0.45, 0.52, 0.66);
uniform float fog_start = 48.0;
uniform float fog_end = 96.0;
uniform float time = 0.0;
uniform float anim_fps = 8.0;
uniform float wind_strength = 0.06;          // metres of travel at full gust
uniform float wind_speed = 1.6;
uniform vec2 wind_dir = vec2(0.8, 0.6);      // world xz direction the wind blows towards
uniform float wind_gust : hint_range(0.0, 1.0) = 0.35;
// Physics-like disturbances: xyz = world position, w = strength 0..1. Slot 0 is the player.
uniform vec4 disturb[6];
uniform int disturb_count = 0;
uniform float block_light_warmth = 1.0;
uniform vec3 sun_dir = vec3(0.0, 1.0, 0.0);      // direction TO the sun/moon (SkyController)
uniform float sun_wrap : hint_range(0.0, 0.5) = 0.13;   // strength of the soft directional term
uniform float light_flicker : hint_range(0.0, 1.0) = 0.25;

varying vec3 v_uv_layer;
varying vec3 v_normal;
varying float v_light;
varying float v_fog;
varying float v_world_phase;

const vec3 BLOCK_LIGHT_COLOR = vec3(1.0, 0.82, 0.58);

// Interleaved gradient noise: one dither value per pixel, breaks up fog/gradient banding.
float chunk_dither(vec2 frag) {
	return fract(52.9829189 * fract(0.06711056 * frag.x + 0.00583715 * frag.y));
}

// Soft "wrap" lambert: a gentle extra tilt toward the sun on top of the flat face factor.
float chunk_sun_wrap(vec3 n, vec3 l) {
	return (dot(n, l) * 0.5 + 0.5) * 0.7 + 0.3;
}

// Stable per-block hash (0..1) so neighbouring leaf cubes are only slightly out of phase.
float block_hash(vec3 b) {
	return fract(sin(dot(b, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

// Wind + disturbance displacement for one vertex.
//   mode   1 = plant (bends at the tip), 2 = leaves (whole block moves)
//   weight 0..1 vertical weight of this vertex (1 at the tip of a plant, 1 everywhere on leaves)
vec3 wind_offset(vec3 world, float mode, float weight) {
	vec2 wd = normalize(wind_dir + vec2(0.0001, 0.0));
	vec3 block = floor(world);
	float jitter = block_hash(block);
	// One low-frequency wave travelling along the wind, identical for shared vertices.
	float phase = dot(world.xz, wd) * 0.35 - time * wind_speed + jitter * 0.9;
	float gust = 0.6 + wind_gust;
	float amp = wind_strength * gust * weight;
	vec2 side = vec2(-wd.y, wd.x);
	vec3 o = vec3(0.0);
	o.xz += wd * (sin(phase) * 0.6 + 0.4) * amp;
	o.xz += side * sin(phase * 1.7 + 1.3) * amp * 0.35;
	o.y += cos(phase * 1.3) * amp * 0.25;
	// Per-block breathing, tiny on purpose: any difference between neighbouring leaf blocks
	// shows up as a seam, so keep it around a centimetre.
	o.xz += vec2(sin(time * 0.7 + jitter * 6.283), cos(time * 0.6 + jitter * 6.283)) * 0.01 * weight;
	// Things moving through the foliage push it aside and press it down.
	for (int i = 0; i < 6; i++) {
		if (i >= disturb_count) {
			break;
		}
		vec4 d = disturb[i];
		if (d.w <= 0.001) {
			continue;
		}
		vec2 delta = world.xz - d.xz;
		float r = 1.6 + d.w * 3.0;
		// The vertical term keeps a canopy still when someone walks far below it.
		float dist = length(vec3(delta.x, (world.y - d.y) * 0.8, delta.y));
		if (dist >= r) {
			continue;
		}
		float t = 1.0 - dist / r;
		float f = t * t * d.w * (mode > 1.5 ? 0.6 : weight);
		float flat_len = max(length(delta), 0.001);
		o.xz += (delta / flat_len) * f * 0.35;
		o.y -= f * 0.35 * 0.15;
	}
	return o;
}

float face_factor(vec3 n) {
	if (n.y > 0.5) return 1.0;
	if (n.y < -0.5) return 0.5;
	if (abs(n.z) > 0.5) return 0.8;
	return 0.6;
}

void vertex() {
	float layer = floor(UV2.x);
	float enc = floor(fract(UV2.x) * 256.0 + 0.5);
	float sway_mode = floor(enc / 64.0);        // 0 static, 1 plant, 2 leaves
	float frames = enc - sway_mode * 64.0;
	if (frames > 1.5) {
		layer += floor(mod(time * anim_fps, frames));
	}
	v_uv_layer = vec3(UV, layer);
	v_normal = NORMAL;
	v_light = UV2.y;
	// Wind: plants bend at the tip, leaf blocks drift as a whole (see the header).
	vec3 world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_world_phase = world.x * 1.7 + world.y * 0.9 + world.z * 2.3;
	if (sway_mode > 0.5) {
		float weight = sway_mode > 1.5 ? 1.0 : (1.0 - clamp(UV.y * 2.0, 0.0, 1.0));
		if (weight > 0.001) {
			VERTEX += wind_offset(world, sway_mode, weight);
		}
	}
	vec3 view = (MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_fog = clamp((length(view) - fog_start) / max(fog_end - fog_start, 0.001), 0.0, 1.0);
}

void fragment() {
	vec4 tex = texture(tiles, v_uv_layer);
	float packed = floor(v_light * 255.0 + 0.5);
	float sky_raw = floor(packed * 0.0625);
	float sky = sky_raw / 15.0;
	float blk = (packed - sky_raw * 16.0) / 15.0;
	vec3 nn = normalize(v_normal);
	float face = face_factor(nn);
	vec3 sky_part = sky * daylight * mix(ambient_color, sun_color, clamp(daylight, 0.0, 1.0));
	// soft directional term: slopes that face the sun read a little warmer than the flat face factor
	sky_part *= mix(1.0, chunk_sun_wrap(nn, normalize(sun_dir)), sun_wrap * clamp(daylight, 0.0, 1.0));
	float flicker = 1.0 - light_flicker * 0.12 * (0.5 + 0.5 * sin(time * 7.3 + v_world_phase));
	vec3 blk_part = blk * BLOCK_LIGHT_COLOR * block_light_warmth * flicker;
	vec3 light = max(sky_part, blk_part) + ambient_color * 0.12;
	vec3 albedo = tex.rgb * COLOR.rgb * light * face * COLOR.a;
	float fog = v_fog * v_fog * (3.0 - 2.0 * v_fog);
	fog = clamp(fog + (chunk_dither(FRAGCOORD.xy) - 0.5) * 0.02, 0.0, 1.0);
	ALBEDO = mix(albedo, fog_color, fog);
	ALPHA = tex.a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
}
