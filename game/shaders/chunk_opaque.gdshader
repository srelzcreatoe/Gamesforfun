// chunk_opaque.gdshader - opaque voxel terrain (gl_compatibility safe).
//
// Written by the voxel agent, polished later by the shaders agent.
//
// Vertex stream produced by ChunkMesher:
//   UV      0..1 tile uv
//   UV2.x   texture array layer + (frames + 64 * sway_mode) / 256. The fractional part holds
//           the tile's animation length (1 = static, 32 = a 32 frame strip; the frames are
//           consecutive layers in Textures.block_array, so layer = base + frame) and the wind
//           mode (0 = static, 1 = plant, 2 = leaves) used by chunk_cutout.gdshader.
//   UV2.y   packed light / 255, packed = sky * 16 + block
//   COLOR   rgb = biome tint, a = ambient occlusion (0.55 / 0.7 / 0.85 / 1.0)
//
// Lighting is unshaded/Minecraft style: face factor (top 1.0, north/south 0.8, east/west 0.6,
// bottom 0.5) * max(sky * daylight, warm block light) * ao, then distance fog.
// The biome tint is masked by the tile alpha (grass_side is opaque where the grass overlay is).
//
// UNIFORM PACKING PASS (shaders agent): the maths, the vertex stream and the look are unchanged.
// What changed is the *transport*: a phone's GL_MAX_FRAGMENT_UNIFORM_VECTORS is only 224 (256 on
// many chips), and a failed link makes Godot draw with an unbound shader, which segfaults real
// drivers. The scalars/vec3s are therefore packed into shared vec4s (see the block below), and
// every tunable that no script ever wrote is now a const.

shader_type spatial;
render_mode unshaded, cull_back, depth_draw_opaque;

// --- packed shared lighting contract ------------------------------------------------------------
// SkyController.apply_to_material / World._push_uniforms / ChunkManager._make_material push these.
// EVERY world shader (chunk_opaque, chunk_cutout, water, clouds and the mobile/ variants) declares
// the SAME names with the SAME payload, so one push works for all of them; a shader that does not
// need a slot simply does not declare it (writing it is then silently ignored, by design).
//   sun_params         xyz sun colour       w daylight
//   fog_params         xyz fog colour       w fog_start
//   ambient_params     xyz ambient colour   w fog_end
//   sun_dir_params     xyz direction TO the sun/moon   w time (seconds)
// (water and clouds additionally declare sky_horizon_params / sky_night_params / sky_sunset_params
//  / sky_day_params - see those files.)
uniform sampler2DArray tiles : source_color, filter_nearest, repeat_disable;
uniform vec4 sun_params = vec4(1.0, 0.96, 0.9, 1.0);
uniform vec4 fog_params = vec4(0.75, 0.84, 0.96, 48.0);
uniform vec4 ambient_params = vec4(0.45, 0.52, 0.66, 96.0);
uniform vec4 sun_dir_params = vec4(0.0, 1.0, 0.0, 0.0);

// Tunables no script has ever written: consts, not uniforms (they cost a fragment uniform vector
// each and a phone has very few). Change them here.
const float ANIM_FPS = 8.0;
const float BLOCK_LIGHT_WARMTH = 1.0;
const float SUN_WRAP = 0.13;          // strength of the soft directional term
const float LIGHT_FLICKER = 0.25;     // 0 = block light does not flicker

varying vec3 v_uv_layer;
varying vec3 v_normal;
varying float v_light;
varying float v_fog;
varying float v_world_phase;

// Warm colour of torch/lava light.
const vec3 BLOCK_LIGHT_COLOR = vec3(1.0, 0.82, 0.58);

// Interleaved gradient noise: one dither value per pixel, breaks up fog/gradient banding.
float chunk_dither(vec2 frag) {
	return fract(52.9829189 * fract(0.06711056 * frag.x + 0.00583715 * frag.y));
}

// Soft "wrap" lambert: a gentle extra tilt toward the sun on top of the flat face factor.
float chunk_sun_wrap(vec3 n, vec3 l) {
	return (dot(n, l) * 0.5 + 0.5) * 0.7 + 0.3;
}

float face_factor(vec3 n) {
	if (n.y > 0.5) return 1.0;
	if (n.y < -0.5) return 0.5;
	if (abs(n.z) > 0.5) return 0.8;
	return 0.6;
}

void vertex() {
	float time = sun_dir_params.w;
	float layer = floor(UV2.x);
	float enc = floor(fract(UV2.x) * 256.0 + 0.5);
	float sway_mode = floor(enc / 64.0);        // 0 static, 1 plant, 2 leaves
	float frames = enc - sway_mode * 64.0;
	if (frames > 1.5) {
		layer += floor(mod(time * ANIM_FPS, frames));
	}
	v_uv_layer = vec3(UV, layer);
	v_normal = NORMAL;
	v_light = UV2.y;
	vec3 world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_world_phase = world.x * 1.7 + world.y * 0.9 + world.z * 2.3;
	vec3 view = (MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float fog_start = fog_params.w;
	float fog_end = ambient_params.w;
	v_fog = clamp((length(view) - fog_start) / max(fog_end - fog_start, 0.001), 0.0, 1.0);
}

void fragment() {
	float daylight = sun_params.w;
	vec3 sun_color = sun_params.rgb;
	vec3 fog_color = fog_params.rgb;
	vec3 ambient_color = ambient_params.rgb;
	vec3 sun_dir = sun_dir_params.xyz;
	float time = sun_dir_params.w;

	vec4 tex = texture(tiles, v_uv_layer);
	// Biome tint, masked by the tile alpha (COLOR.rgb is white for untinted blocks).
	vec3 tint = mix(vec3(1.0), COLOR.rgb, tex.a);
	float packed = floor(v_light * 255.0 + 0.5);
	float sky_raw = floor(packed * 0.0625);
	float sky = sky_raw / 15.0;
	float blk = (packed - sky_raw * 16.0) / 15.0;
	float ao = COLOR.a;
	vec3 nn = normalize(v_normal);
	float face = face_factor(nn);
	vec3 sky_part = sky * daylight * mix(ambient_color, sun_color, clamp(daylight, 0.0, 1.0));
	// soft directional term: slopes that face the sun read a little warmer than the flat face factor
	sky_part *= mix(1.0, chunk_sun_wrap(nn, normalize(sun_dir)), SUN_WRAP * clamp(daylight, 0.0, 1.0));
	float flicker = 1.0 - LIGHT_FLICKER * 0.12 * (0.5 + 0.5 * sin(time * 7.3 + v_world_phase));
	vec3 blk_part = blk * BLOCK_LIGHT_COLOR * BLOCK_LIGHT_WARMTH * flicker;
	vec3 light = max(sky_part, blk_part) + ambient_color * 0.12;
	vec3 albedo = tex.rgb * tint * light * face * ao;
	float fog = v_fog * v_fog * (3.0 - 2.0 * v_fog);
	fog = clamp(fog + (chunk_dither(FRAGCOORD.xy) - 0.5) * 0.02, 0.0, 1.0);
	ALBEDO = mix(albedo, fog_color, fog);
}
