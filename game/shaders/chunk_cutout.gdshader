// chunk_cutout.gdshader - alpha-scissor voxel geometry: leaves, plants, glass, torches, doors.
//
// Written by the voxel agent, polished later by the shaders agent: KEEP THE UNIFORM NAMES.
// Same vertex stream as chunk_opaque.gdshader (see its header for UV2/COLOR packing), except:
//   * the biome tint is applied to the whole texel (plants are fully tinted, not masked),
//   * ALPHA_SCISSOR_THRESHOLD 0.5 punches out the transparent texels,
//   * vertices whose uv is in the upper half of the tile (v < 0.5) sway with the wind, so
//     grass and leaves move at their tips and stay anchored at the bottom.

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
uniform float wind_strength = 0.045;
uniform float wind_speed = 1.6;
uniform float block_light_warmth = 1.0;

varying vec3 v_uv_layer;
varying vec3 v_normal;
varying float v_light;
varying float v_fog;

const vec3 BLOCK_LIGHT_COLOR = vec3(1.0, 0.82, 0.58);

float face_factor(vec3 n) {
	if (n.y > 0.5) return 1.0;
	if (n.y < -0.5) return 0.5;
	if (abs(n.z) > 0.5) return 0.8;
	return 0.6;
}

void vertex() {
	float layer = floor(UV2.x);
	float frames = floor(fract(UV2.x) * 64.0 + 0.5);
	if (frames > 1.5) {
		layer += floor(mod(time * anim_fps, frames));
	}
	v_uv_layer = vec3(UV, layer);
	v_normal = NORMAL;
	v_light = UV2.y;
	// Gentle wind sway. Only the top half of a tile moves; the phase comes from the world
	// position so neighbouring plants are out of step.
	vec3 world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float amount = (1.0 - clamp(UV.y * 2.0, 0.0, 1.0)) * wind_strength;
	if (amount > 0.0001) {
		float phase = world.x * 0.7 + world.z * 0.9 + world.y * 0.15;
		VERTEX.x += sin(time * wind_speed + phase) * amount;
		VERTEX.z += cos(time * wind_speed * 0.83 + phase * 1.21) * amount;
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
	float face = face_factor(normalize(v_normal));
	vec3 sky_part = sky * daylight * mix(ambient_color, sun_color, clamp(daylight, 0.0, 1.0));
	vec3 blk_part = blk * BLOCK_LIGHT_COLOR * block_light_warmth;
	vec3 light = max(sky_part, blk_part) + ambient_color * 0.12;
	vec3 albedo = tex.rgb * COLOR.rgb * light * face * COLOR.a;
	ALBEDO = mix(albedo, fog_color, v_fog);
	ALPHA = tex.a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
}
