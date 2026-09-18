// mobile/chunk_cutout_mobile.gdshader - the phone variant of shaders/chunk_cutout.gdshader.
//
// SIX uniforms, all a subset of the desktop names with the same payload (see the shared contract in
// shaders/chunk_opaque.gdshader), so ChunkManager / World / SkyController push the same values to
// either shader. GLES3 guarantees only 224 fragment uniform vectors; a failed link makes Godot draw
// with an unbound shader, which segfaults real phone drivers.
//
// Same vertex stream, same UV2 sway_mode packing, same biome tint / AO / face shading / tile
// animation and the same wind sway as the desktop shader. What is gone: the per-pixel dither, the
// soft directional sun term, the block-light flicker and the `disturb[]` push-aside (the six
// world-space disturbances would cost six more uniform vectors; World still writes them and this
// shader simply does not declare them).

shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_opaque;

//   sun_params      xyz sun colour      w daylight
//   fog_params      xyz fog colour      w fog_start
//   ambient_params  xyz ambient colour  w fog_end
//   sun_dir_params  xyz direction TO the sun (unused here)  w time (seconds)
//   wind_params     xy wind xz direction, z travel in metres at full gust, w gust 0..1
uniform sampler2DArray tiles : source_color, filter_nearest, repeat_disable;
uniform vec4 sun_params = vec4(1.0, 0.96, 0.9, 1.0);
uniform vec4 fog_params = vec4(0.75, 0.84, 0.96, 48.0);
uniform vec4 ambient_params = vec4(0.45, 0.52, 0.66, 96.0);
uniform vec4 sun_dir_params = vec4(0.0, 1.0, 0.0, 0.0);
uniform vec4 wind_params = vec4(0.8, 0.6, 0.06, 0.35);

const float ANIM_FPS = 8.0;
const float WIND_SPEED = 1.6;
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

float block_hash(vec3 b) {
	return fract(sin(dot(b, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

// Identical travelling wave to the desktop shader (minus the disturbance loop), so a canopy still
// moves as one piece and no cracks open between shared vertices.
vec3 wind_offset(vec3 world, float weight) {
	float time = sun_dir_params.w;
	vec2 wd = normalize(wind_params.xy + vec2(0.0001, 0.0));
	float jitter = block_hash(floor(world));
	float phase = dot(world.xz, wd) * 0.35 - time * WIND_SPEED + jitter * 0.9;
	float amp = wind_params.z * (0.6 + wind_params.w) * weight;
	vec2 side = vec2(-wd.y, wd.x);
	vec3 o = vec3(0.0);
	o.xz += wd * (sin(phase) * 0.6 + 0.4) * amp;
	o.xz += side * sin(phase * 1.7 + 1.3) * amp * 0.35;
	o.y += cos(phase * 1.3) * amp * 0.25;
	o.xz += vec2(sin(time * 0.7 + jitter * 6.283), cos(time * 0.6 + jitter * 6.283)) * 0.01 * weight;
	return o;
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
	if (sway_mode > 0.5) {
		float weight = sway_mode > 1.5 ? 1.0 : (1.0 - clamp(UV.y * 2.0, 0.0, 1.0));
		if (weight > 0.001) {
			VERTEX += wind_offset(world, weight);
		}
	}
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
	float packed = floor(v_light * 255.0 + 0.5);
	float sky_raw = floor(packed * 0.0625);
	float sky = sky_raw / 15.0;
	float blk = (packed - sky_raw * 16.0) / 15.0;
	float face = face_factor(normalize(v_normal));
	vec3 sky_part = sky * daylight * mix(ambient_color, sun_color, clamp(daylight, 0.0, 1.0));
	vec3 light = max(sky_part, blk * BLOCK_LIGHT_COLOR) + ambient_color * 0.12;
	vec3 albedo = tex.rgb * COLOR.rgb * light * face * COLOR.a;
	float fog = v_fog * v_fog * (3.0 - 2.0 * v_fog);
	ALBEDO = mix(albedo, fog_color, fog);
	ALPHA = tex.a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
}
