// mobile/chunk_opaque_mobile.gdshader - the phone variant of shaders/chunk_opaque.gdshader.
//
// ChunkManager loads this instead of the desktop shader when Game.is_mobile() (or with the
// --force-mobile-shaders debug flag). GLES3 only guarantees 224 fragment uniform vectors and
// several phone GPUs report 256; when a program fails to link Godot keeps drawing with an unbound
// shader, which is a native crash on a real driver. This variant therefore declares FIVE uniforms,
// all of them a subset of the desktop names with the same payload, so the same push code feeds
// both (see the shared contract in shaders/chunk_opaque.gdshader).
//
// Same vertex stream, same UV2 packing, same biome tint / AO / face shading / tile animation and
// the same fog curve as the desktop shader. What is gone: the per-pixel dither, the soft
// directional sun term and the block-light flicker.
//
// No mipmaps: Textures.build_block_array uploads the block Texture2DArray without a mip chain, and
// sampling an incomplete texture with a mipmap filter returns BLACK on GLES3 drivers.

shader_type spatial;
render_mode unshaded, cull_back, depth_draw_opaque;

//   sun_params      xyz sun colour      w daylight
//   fog_params      xyz fog colour      w fog_start
//   ambient_params  xyz ambient colour  w fog_end
//   sun_dir_params  xyz direction TO the sun (unused here)  w time (seconds)
uniform sampler2DArray tiles : source_color, filter_nearest, repeat_disable;
uniform vec4 sun_params = vec4(1.0, 0.96, 0.9, 1.0);
uniform vec4 fog_params = vec4(0.75, 0.84, 0.96, 48.0);
uniform vec4 ambient_params = vec4(0.45, 0.52, 0.66, 96.0);
uniform vec4 sun_dir_params = vec4(0.0, 1.0, 0.0, 0.0);

const float ANIM_FPS = 8.0;
const vec3 BLOCK_LIGHT_COLOR = vec3(1.0, 0.82, 0.58);

varying vec3 v_uv_layer;
varying vec3 v_normal;
varying float v_light;
varying float v_fog;

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
	float sway_mode = floor(enc / 64.0);
	float frames = enc - sway_mode * 64.0;
	if (frames > 1.5) {
		layer += floor(mod(time * ANIM_FPS, frames));
	}
	v_uv_layer = vec3(UV, layer);
	v_normal = NORMAL;
	v_light = UV2.y;
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

	vec4 tex = texture(tiles, v_uv_layer);
	vec3 tint = mix(vec3(1.0), COLOR.rgb, tex.a);
	float packed = floor(v_light * 255.0 + 0.5);
	float sky_raw = floor(packed * 0.0625);
	float sky = sky_raw / 15.0;
	float blk = (packed - sky_raw * 16.0) / 15.0;
	float face = face_factor(normalize(v_normal));
	vec3 sky_part = sky * daylight * mix(ambient_color, sun_color, clamp(daylight, 0.0, 1.0));
	vec3 light = max(sky_part, blk * BLOCK_LIGHT_COLOR) + ambient_color * 0.12;
	vec3 albedo = tex.rgb * tint * light * face * COLOR.a;
	float fog = v_fog * v_fog * (3.0 - 2.0 * v_fog);
	ALBEDO = mix(albedo, fog_color, fog);
}
